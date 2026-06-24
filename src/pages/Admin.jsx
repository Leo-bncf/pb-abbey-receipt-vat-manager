import React, { useState, useMemo } from 'react';
import { motion } from 'framer-motion';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { 
  Shield, FileText, AlertCircle, CheckCircle, Search, ChevronLeft, ChevronRight, Sparkles, TrendingUp, Copy
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { base44 } from '@/api/base44Client';
import ReceiptReviewPanel from '../components/admin/ReceiptReviewPanel';
import AIBulkTraining from '../components/admin/AIBulkTraining';
import AILearningTab from '../components/admin/AILearningTab';
import DuplicatesTab from '../components/admin/DuplicatesTab';
import StatsCard from '../components/stats/StatsCard';
import { format } from 'date-fns';

export default function Admin() {
  const [selectedReceipt, setSelectedReceipt] = useState(null);
  const [reviewFilter, setReviewFilter] = useState('needs_review');
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState('review');
  const queryClient = useQueryClient();

  const { data: receipts = [] } = useQuery({
    queryKey: ['receipts'],
    queryFn: () => base44.entities.Receipt.list('-created_date'),
  });

  const { data: corrections = [] } = useQuery({
    queryKey: ['corrections'],
    queryFn: () => base44.entities.ReceiptCorrection.list('-created_date'),
  });

  const { data: feedbackList = [] } = useQuery({
    queryKey: ['feedback'],
    queryFn: () => base44.entities.AIFeedback.list('-created_date'),
  });

  const updateReceiptMutation = useMutation({
    mutationFn: async ({ id, data }) => {
      return base44.entities.Receipt.update(id, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['receipts'] });
    },
  });

  const createCorrectionMutation = useMutation({
    mutationFn: async (correctionData) => {
      return base44.entities.ReceiptCorrection.create(correctionData);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['corrections'] });
    },
  });

  const updateFeedbackMutation = useMutation({
    mutationFn: async ({ id, data }) => {
      return base44.entities.AIFeedback.update(id, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['feedback'] });
    },
  });

  // Stats
  const stats = useMemo(() => {
    const needsReview = receipts.filter(r => r.needs_review && !r.is_reviewed).length;
    const reviewed = receipts.filter(r => r.is_reviewed).length;
    const avgConfidence = receipts.length > 0 
      ? Math.round(receipts.reduce((sum, r) => sum + (r.confidence_score || 0), 0) / receipts.length)
      : 0;
    const totalCorrections = corrections.length;
    const rulesLearned = feedbackList.filter(f => f.rule_learned).length;

    return { needsReview, reviewed, avgConfidence, totalCorrections, rulesLearned };
  }, [receipts, corrections, feedbackList]);

  // Filtered receipts
  const filteredReceipts = useMemo(() => {
    let filtered = [...receipts];

    if (reviewFilter === 'needs_review') {
      filtered = filtered.filter(r => r.needs_review && !r.is_reviewed);
    } else if (reviewFilter === 'reviewed') {
      filtered = filtered.filter(r => r.is_reviewed);
    } else if (reviewFilter === 'low_confidence') {
      filtered = filtered.filter(r => (r.confidence_score || 0) < 70);
    }

    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(r => 
        r.vendor_name?.toLowerCase().includes(query) ||
        r.file_name?.toLowerCase().includes(query)
      );
    }

    return filtered;
  }, [receipts, reviewFilter, searchQuery]);

  const handleSaveReview = async (updatedData, corrections) => {
    const user = await base44.auth.me();
    
    // Update the receipt
    await updateReceiptMutation.mutateAsync({
      id: selectedReceipt.id,
      data: {
        ...updatedData,
        status: 'reviewed',
        reviewed_by: user.email,
        needs_review: false
      }
    });

    // Save corrections
    for (const [field, values] of Object.entries(corrections)) {
      await createCorrectionMutation.mutateAsync({
        receipt_id: selectedReceipt.id,
        field_name: field,
        original_value: String(values.original || ''),
        corrected_value: String(values.corrected || ''),
        corrected_by: user.email
      });
    }

    // Move to next receipt
    const currentIndex = filteredReceipts.findIndex(r => r.id === selectedReceipt.id);
    const nextReceipt = filteredReceipts[currentIndex + 1];
    setSelectedReceipt(nextReceipt || null);
  };

  const navigateReceipt = (direction) => {
    const currentIndex = filteredReceipts.findIndex(r => r.id === selectedReceipt.id);
    const newIndex = direction === 'next' ? currentIndex + 1 : currentIndex - 1;
    if (newIndex >= 0 && newIndex < filteredReceipts.length) {
      setSelectedReceipt(filteredReceipts[newIndex]);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100">
      <div className="max-w-7xl mx-auto px-6 py-8">
        {/* Header */}
        <div className="flex items-center gap-4 mb-8">
          <div className="w-12 h-12 rounded-xl bg-indigo-100 flex items-center justify-center">
            <Shield className="w-6 h-6 text-indigo-600" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-slate-800">Admin Panel</h1>
            <p className="text-slate-500">Review receipts and train AI accuracy</p>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-8">
          <StatsCard
            title="Needs Review"
            value={stats.needsReview}
            icon={AlertCircle}
            color={stats.needsReview > 0 ? 'amber' : 'emerald'}
            index={0}
          />
          <StatsCard
            title="Reviewed"
            value={stats.reviewed}
            icon={CheckCircle}
            color="emerald"
            index={1}
          />
          <StatsCard
            title="Avg Confidence"
            value={`${stats.avgConfidence}%`}
            icon={TrendingUp}
            color="blue"
            index={2}
          />
          <StatsCard
            title="Corrections"
            value={stats.totalCorrections}
            icon={FileText}
            color="purple"
            index={3}
          />
          <StatsCard
            title="Rules Learned"
            value={stats.rulesLearned}
            icon={Sparkles}
            color="indigo"
            index={4}
          />
        </div>

        {/* Tabs */}
        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
          <TabsList className="bg-white border border-slate-200">
            <TabsTrigger value="review" className="gap-2">
              <FileText className="w-4 h-4" />
              Review Receipts
            </TabsTrigger>
            <TabsTrigger value="training" className="gap-2">
              <Sparkles className="w-4 h-4" />
              AI Bulk Training
            </TabsTrigger>
            <TabsTrigger value="learning" className="gap-2">
              <Sparkles className="w-4 h-4" />
              AI Learning
            </TabsTrigger>
            <TabsTrigger value="duplicates" className="gap-2">
              <Copy className="w-4 h-4" />
              Duplicates
            </TabsTrigger>
            <TabsTrigger value="corrections" className="gap-2">
              <AlertCircle className="w-4 h-4" />
              Corrections
            </TabsTrigger>
          </TabsList>

          {/* Review Tab */}
          <TabsContent value="review">
            <div className="flex gap-6">
              {/* Receipt List */}
              <div className="w-1/3 space-y-4">
                {/* Filters */}
                <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-3">
                  <div className="relative">
                    <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                    <Input
                      placeholder="Search..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="pl-9"
                    />
                  </div>
                  <Select value={reviewFilter} onValueChange={setReviewFilter}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Receipts</SelectItem>
                      <SelectItem value="needs_review">Needs Review</SelectItem>
                      <SelectItem value="reviewed">Reviewed</SelectItem>
                      <SelectItem value="low_confidence">Low Confidence</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {/* Receipt List */}
                <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                  <div className="px-4 py-3 border-b border-slate-200">
                    <p className="text-sm text-slate-600">
                      {filteredReceipts.length} receipts
                    </p>
                  </div>
                  <div className="max-h-[calc(100vh-400px)] overflow-y-auto divide-y divide-slate-100">
                    {filteredReceipts.map((receipt) => (
                      <motion.button
                        key={receipt.id}
                        onClick={() => setSelectedReceipt(receipt)}
                        className={`w-full p-4 text-left hover:bg-slate-50 transition-colors ${
                          selectedReceipt?.id === receipt.id ? 'bg-indigo-50' : ''
                        }`}
                        whileHover={{ x: 2 }}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex-1 min-w-0">
                            <p className="font-medium text-slate-800 truncate">
                              {receipt.vendor_name || 'Unknown Vendor'}
                            </p>
                            <p className="text-xs text-slate-400 truncate">
                              {receipt.file_name}
                            </p>
                          </div>
                          <div className="flex flex-col items-end gap-1">
                            {receipt.needs_review && !receipt.is_reviewed && (
                              <Badge className="bg-amber-100 text-amber-700 text-xs">
                                Review
                              </Badge>
                            )}
                            {receipt.is_reviewed && (
                              <Badge className="bg-green-100 text-green-700 text-xs">
                                Done
                              </Badge>
                            )}
                            <span className={`text-xs ${
                              (receipt.confidence_score || 0) >= 80 ? 'text-green-600' :
                              (receipt.confidence_score || 0) >= 50 ? 'text-amber-600' :
                              'text-red-600'
                            }`}>
                              {receipt.confidence_score || 0}%
                            </span>
                          </div>
                        </div>
                      </motion.button>
                    ))}
                    {filteredReceipts.length === 0 && (
                      <div className="p-8 text-center text-slate-500">
                        No receipts found
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Review Panel */}
              <div className="flex-1">
                {selectedReceipt ? (
                  <>
                    {/* Navigation */}
                    <div className="flex items-center justify-between mb-4">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => navigateReceipt('prev')}
                        disabled={filteredReceipts.findIndex(r => r.id === selectedReceipt.id) === 0}
                      >
                        <ChevronLeft className="w-4 h-4 mr-1" />
                        Previous
                      </Button>
                      <span className="text-sm text-slate-500">
                        {filteredReceipts.findIndex(r => r.id === selectedReceipt.id) + 1} of {filteredReceipts.length}
                      </span>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => navigateReceipt('next')}
                        disabled={filteredReceipts.findIndex(r => r.id === selectedReceipt.id) === filteredReceipts.length - 1}
                      >
                        Next
                        <ChevronRight className="w-4 h-4 ml-1" />
                      </Button>
                    </div>
                    <ReceiptReviewPanel
                      receipt={selectedReceipt}
                      onSave={handleSaveReview}
                      onClose={() => setSelectedReceipt(null)}
                      isSaving={updateReceiptMutation.isPending}
                    />
                  </>
                ) : (
                  <div className="bg-white rounded-xl border border-slate-200 p-12 text-center h-full flex flex-col items-center justify-center">
                    <div className="w-16 h-16 rounded-2xl bg-slate-100 flex items-center justify-center mb-4">
                      <FileText className="w-8 h-8 text-slate-400" />
                    </div>
                    <h3 className="text-lg font-semibold text-slate-800 mb-2">Select a Receipt</h3>
                    <p className="text-slate-500">
                      Choose a receipt from the list to review and correct
                    </p>
                  </div>
                )}
              </div>
            </div>
          </TabsContent>

          {/* AI Bulk Training Tab */}
          <TabsContent value="training">
            <div className="h-[calc(100vh-300px)]">
              <AIBulkTraining />
            </div>
          </TabsContent>

          {/* AI Learning Tab */}
          <TabsContent value="learning">
            <AILearningTab
              feedbackList={feedbackList}
              corrections={corrections}
              onUpdateFeedback={(id, data) => updateFeedbackMutation.mutate({ id, data })}
            />
          </TabsContent>



          {/* Duplicates Tab */}
          <TabsContent value="duplicates">
            <DuplicatesTab />
          </TabsContent>

          {/* Corrections History Tab */}
          <TabsContent value="corrections">
            <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
              <div className="px-6 py-4 border-b border-slate-200">
                <h3 className="font-semibold text-slate-800">Correction History</h3>
                <p className="text-sm text-slate-500">All corrections made to receipt data</p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-slate-50">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase">Receipt</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase">Field</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase">Original</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase">Corrected</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase">By</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase">Date</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {corrections.map((correction, index) => (
                      <motion.tr
                        key={correction.id}
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ delay: index * 0.02 }}
                        className="hover:bg-slate-50"
                      >
                        <td className="px-6 py-4 text-sm text-slate-800">
                          {correction.receipt_id?.substring(0, 8)}...
                        </td>
                        <td className="px-6 py-4">
                          <Badge variant="outline">{correction.field_name}</Badge>
                        </td>
                        <td className="px-6 py-4 text-sm text-red-600 line-through">
                          {correction.original_value || '-'}
                        </td>
                        <td className="px-6 py-4 text-sm text-green-600 font-medium">
                          {correction.corrected_value}
                        </td>
                        <td className="px-6 py-4 text-sm text-slate-500">
                          {correction.corrected_by}
                        </td>
                        <td className="px-6 py-4 text-sm text-slate-500">
                          {correction.created_date && format(new Date(correction.created_date), 'dd MMM yyyy')}
                        </td>
                      </motion.tr>
                    ))}
                    {corrections.length === 0 && (
                      <tr>
                        <td colSpan={6} className="px-6 py-12 text-center text-slate-500">
                          No corrections recorded yet
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
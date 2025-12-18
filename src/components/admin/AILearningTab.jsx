import React, { useState, useMemo } from 'react';
import { motion } from 'framer-motion';
import { 
  Brain, CheckCircle, Filter, X, Search, Sparkles, 
  AlertCircle, TrendingUp, ArrowUp, ArrowDown, Ban
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { format } from 'date-fns';

export default function AILearningTab({ 
  feedbackList = [], 
  corrections = [], 
  onUpdateFeedback 
}) {
  const [filterVendor, setFilterVendor] = useState('');
  const [filterCountry, setFilterCountry] = useState('');
  const [filterVATRate, setFilterVATRate] = useState('');
  const [filterKeyword, setFilterKeyword] = useState('');
  const [filterPriority, setFilterPriority] = useState('all');

  // Filter feedback
  const filteredFeedback = useMemo(() => {
    let filtered = [...feedbackList];
    
    if (filterPriority !== 'all') {
      filtered = filtered.filter(f => (f.priority || 'normal') === filterPriority);
    }
    
    if (filterVendor) {
      const query = filterVendor.toLowerCase();
      filtered = filtered.filter(f => 
        f.vendor_name?.toLowerCase().includes(query) ||
        f.rule_learned?.toLowerCase().includes(query) ||
        f.user_message?.toLowerCase().includes(query)
      );
    }
    
    if (filterCountry) {
      const query = filterCountry.toLowerCase();
      filtered = filtered.filter(f => 
        f.country?.toLowerCase().includes(query) ||
        f.rule_learned?.toLowerCase().includes(query)
      );
    }
    
    if (filterVATRate) {
      const rate = parseFloat(filterVATRate);
      filtered = filtered.filter(f => 
        f.vat_rate === rate ||
        f.rule_learned?.includes(`${rate}%`) ||
        f.user_message?.includes(`${rate}%`)
      );
    }
    
    if (filterKeyword) {
      const query = filterKeyword.toLowerCase();
      filtered = filtered.filter(f =>
        f.rule_learned?.toLowerCase().includes(query) ||
        f.user_message?.toLowerCase().includes(query)
      );
    }
    
    return filtered;
  }, [feedbackList, filterPriority, filterVendor, filterCountry, filterVATRate, filterKeyword]);

  // Filter corrections
  const filteredCorrections = useMemo(() => {
    let filtered = [...corrections];
    
    if (filterVendor || filterKeyword) {
      const query = (filterVendor || filterKeyword).toLowerCase();
      filtered = filtered.filter(c =>
        c.field_name?.toLowerCase().includes(query) ||
        c.corrected_value?.toLowerCase().includes(query) ||
        c.original_value?.toLowerCase().includes(query) ||
        c.correction_reason?.toLowerCase().includes(query)
      );
    }
    
    return filtered;
  }, [corrections, filterVendor, filterKeyword]);

  const clearFilters = () => {
    setFilterVendor('');
    setFilterCountry('');
    setFilterVATRate('');
    setFilterKeyword('');
    setFilterPriority('all');
  };

  const getPriorityIcon = (priority) => {
    switch (priority) {
      case 'high': return <TrendingUp className="w-3 h-3" />;
      case 'low': return <ArrowDown className="w-3 h-3" />;
      case 'disabled': return <Ban className="w-3 h-3" />;
      default: return null;
    }
  };

  const getPriorityColor = (priority) => {
    switch (priority) {
      case 'high': return 'bg-amber-100 text-amber-700 border-amber-200';
      case 'low': return 'bg-slate-100 text-slate-600 border-slate-200';
      case 'disabled': return 'bg-red-100 text-red-700 border-red-200';
      default: return 'bg-indigo-100 text-indigo-700 border-indigo-200';
    }
  };

  return (
    <div className="space-y-6">
      {/* Filters */}
      <div className="bg-white rounded-2xl border border-slate-200 p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-slate-800 flex items-center gap-2">
            <Filter className="w-5 h-5 text-slate-600" />
            Filters
          </h3>
          <Button
            variant="ghost"
            size="sm"
            onClick={clearFilters}
            className="text-slate-500 hover:text-slate-700"
          >
            <X className="w-4 h-4 mr-1" />
            Clear All
          </Button>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-3">
          <div>
            <label className="text-xs text-slate-600 block mb-1">Vendor</label>
            <div className="relative">
              <Search className="w-3 h-3 text-slate-400 absolute left-2 top-1/2 -translate-y-1/2" />
              <Input
                placeholder="Search vendor..."
                value={filterVendor}
                onChange={(e) => setFilterVendor(e.target.value)}
                className="h-9 pl-7 text-sm"
              />
            </div>
          </div>
          <div>
            <label className="text-xs text-slate-600 block mb-1">Country</label>
            <Input
              placeholder="e.g., United Kingdom"
              value={filterCountry}
              onChange={(e) => setFilterCountry(e.target.value)}
              className="h-9 text-sm"
            />
          </div>
          <div>
            <label className="text-xs text-slate-600 block mb-1">VAT Rate (%)</label>
            <Input
              type="number"
              placeholder="e.g., 20"
              value={filterVATRate}
              onChange={(e) => setFilterVATRate(e.target.value)}
              className="h-9 text-sm"
            />
          </div>
          <div>
            <label className="text-xs text-slate-600 block mb-1">Keyword</label>
            <div className="relative">
              <Search className="w-3 h-3 text-slate-400 absolute left-2 top-1/2 -translate-y-1/2" />
              <Input
                placeholder="Search rules..."
                value={filterKeyword}
                onChange={(e) => setFilterKeyword(e.target.value)}
                className="h-9 pl-7 text-sm"
              />
            </div>
          </div>
          <div>
            <label className="text-xs text-slate-600 block mb-1">Priority</label>
            <Select value={filterPriority} onValueChange={setFilterPriority}>
              <SelectTrigger className="h-9 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Priority</SelectItem>
                <SelectItem value="high">High Priority</SelectItem>
                <SelectItem value="normal">Normal</SelectItem>
                <SelectItem value="low">Low Priority</SelectItem>
                <SelectItem value="disabled">Disabled</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      {/* Learned Rules */}
      <div className="bg-white rounded-2xl border border-slate-200 p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-slate-800 flex items-center gap-2">
            <Brain className="w-5 h-5 text-indigo-600" />
            Learned Rules & Patterns
          </h3>
          <Badge variant="outline">
            {filteredFeedback.length} of {feedbackList.length} rules
          </Badge>
        </div>
        
        <div className="space-y-3 max-h-[500px] overflow-y-auto pr-2">
          {filteredFeedback.length === 0 ? (
            <div className="text-center py-12 text-slate-500">
              <AlertCircle className="w-8 h-8 mx-auto mb-3 text-slate-300" />
              <p>No rules match your filters</p>
            </div>
          ) : (
            filteredFeedback.map((feedback, index) => (
              <motion.div
                key={feedback.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.03 }}
                className={`p-4 rounded-lg border transition-all ${
                  (feedback.priority || 'normal') === 'disabled'
                    ? 'bg-slate-50 border-slate-300 opacity-60'
                    : getPriorityColor(feedback.priority || 'normal').replace('text-', 'border-').split(' ')[0] + ' ' + getPriorityColor(feedback.priority || 'normal')
                }`}
              >
                <div className="flex items-start justify-between gap-3 mb-3">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge className="text-xs">
                      {feedback.feedback_type}
                    </Badge>
                    <Select
                      value={feedback.priority || 'normal'}
                      onValueChange={(value) => onUpdateFeedback(feedback.id, { priority: value })}
                    >
                      <SelectTrigger className="h-7 w-32 text-xs">
                        <div className="flex items-center gap-1">
                          {getPriorityIcon(feedback.priority || 'normal')}
                          <SelectValue />
                        </div>
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="high">
                          <div className="flex items-center gap-2">
                            <TrendingUp className="w-3 h-3" />
                            High Priority
                          </div>
                        </SelectItem>
                        <SelectItem value="normal">Normal</SelectItem>
                        <SelectItem value="low">
                          <div className="flex items-center gap-2">
                            <ArrowDown className="w-3 h-3" />
                            Low Priority
                          </div>
                        </SelectItem>
                        <SelectItem value="disabled">
                          <div className="flex items-center gap-2">
                            <Ban className="w-3 h-3" />
                            Disabled
                          </div>
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <span className="text-xs text-slate-400 whitespace-nowrap">
                    {format(new Date(feedback.created_date), 'dd MMM yyyy')}
                  </span>
                </div>

                {feedback.rule_learned && (
                  <p className={`text-sm font-medium mb-2 ${
                    (feedback.priority || 'normal') === 'disabled'
                      ? 'text-slate-600 line-through'
                      : ''
                  }`}>
                    {feedback.rule_learned}
                  </p>
                )}
                
                <p className="text-sm text-slate-600 mb-2">
                  {feedback.user_message}
                </p>

                <div className="flex items-center gap-3 text-xs text-slate-400 flex-wrap">
                  {feedback.submitted_by && (
                    <span className="flex items-center gap-1">
                      By: {feedback.submitted_by}
                    </span>
                  )}
                  {feedback.vendor_name && (
                    <span className="flex items-center gap-1">
                      • Vendor: <strong className="text-slate-600">{feedback.vendor_name}</strong>
                    </span>
                  )}
                  {feedback.country && (
                    <span>• {feedback.country}</span>
                  )}
                  {feedback.vat_rate && (
                    <span>• VAT: {feedback.vat_rate}%</span>
                  )}
                </div>

                {(feedback.priority || 'normal') === 'disabled' && (
                  <div className="mt-3 p-2 bg-red-50 border border-red-200 rounded flex items-center gap-2 text-xs text-red-700">
                    <Ban className="w-4 h-4" />
                    This rule is disabled and won't be applied to future extractions
                  </div>
                )}
              </motion.div>
            ))
          )}
        </div>
      </div>

      {/* Field Corrections */}
      <div className="bg-white rounded-2xl border border-slate-200 p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-slate-800 flex items-center gap-2">
            <CheckCircle className="w-5 h-5 text-green-600" />
            Field Corrections History
          </h3>
          <Badge variant="outline">
            {filteredCorrections.length} of {corrections.length} corrections
          </Badge>
        </div>
        
        <div className="space-y-3 max-h-[400px] overflow-y-auto pr-2">
          {filteredCorrections.length === 0 ? (
            <div className="text-center py-12 text-slate-500">
              <AlertCircle className="w-8 h-8 mx-auto mb-3 text-slate-300" />
              <p>No corrections match your filters</p>
            </div>
          ) : (
            filteredCorrections.map((correction, index) => (
              <motion.div
                key={correction.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.03 }}
                className="p-4 bg-slate-50 rounded-lg border border-slate-200"
              >
                <div className="flex items-start justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="text-xs">
                      {correction.field_name}
                    </Badge>
                    {correction.corrected_by && (
                      <span className="text-xs text-slate-400">
                        by {correction.corrected_by}
                      </span>
                    )}
                  </div>
                  <span className="text-xs text-slate-400">
                    {format(new Date(correction.created_date), 'dd MMM yyyy')}
                  </span>
                </div>
                <div className="text-sm space-y-1">
                  <p className="text-slate-500">
                    <span className="line-through">{correction.original_value}</span>
                  </p>
                  <p className="text-green-700 font-medium">
                    → {correction.corrected_value}
                  </p>
                  {correction.correction_reason && (
                    <p className="text-slate-600 text-xs mt-2 italic">
                      {correction.correction_reason}
                    </p>
                  )}
                </div>
              </motion.div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
import React, { useState, useMemo } from 'react';
import { motion } from 'framer-motion';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { 
  FileText, Upload, Coins, Percent, Building2, 
  TrendingUp, AlertCircle, Download, Filter, 
  Grid, List, Search, Calendar, Trash2, Folder
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { base44 } from '@/api/base44Client';
import { createPageUrl } from '@/utils';
import StatsCard from '../components/stats/StatsCard';
import ReceiptCard from '../components/receipts/ReceiptCard';
import ReceiptTable from '../components/receipts/ReceiptTable';
import ReceiptDetailModal from '../components/receipts/ReceiptDetailModal';
import FolderTree from '../components/folders/FolderTree';
import FolderManager from '../components/folders/FolderManager';
import MoveToFolderDialog from '../components/folders/MoveToFolderDialog';
import { format, startOfMonth, endOfMonth, subMonths, parseISO } from 'date-fns';

export default function Dashboard() {
  const [viewMode, setViewMode] = useState('grid');
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [dateFilter, setDateFilter] = useState('all');
  const [selectedReceipt, setSelectedReceipt] = useState(null);
  const [sortField, setSortField] = useState('created_date');
  const [sortDirection, setSortDirection] = useState('desc');
  const [selectedIds, setSelectedIds] = useState([]);
  const [currentFolderId, setCurrentFolderId] = useState(null);
  const [expandedFolders, setExpandedFolders] = useState([]);
  const [showMoveDialog, setShowMoveDialog] = useState(false);

  const { data: receipts = [], isLoading } = useQuery({
    queryKey: ['receipts'],
    queryFn: () => base44.entities.Receipt.list('-created_date'),
  });

  const { data: folders = [] } = useQuery({
    queryKey: ['folders'],
    queryFn: () => base44.entities.Folder.list('name'),
  });

  const queryClient = useQueryClient();

  const deleteReceiptsMutation = useMutation({
    mutationFn: async (ids) => {
      for (const id of ids) {
        await base44.entities.Receipt.delete(id);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['receipts'] });
      setSelectedIds([]);
    },
  });

  const deleteFolderMutation = useMutation({
    mutationFn: async (folderId) => {
      await base44.entities.Folder.delete(folderId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['folders'] });
      if (currentFolderId) {
        setCurrentFolderId(null);
      }
    },
  });

  const renameFolderMutation = useMutation({
    mutationFn: async ({ folderId, name }) => {
      await base44.entities.Folder.update(folderId, { name });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['folders'] });
    },
  });

  const moveReceiptsMutation = useMutation({
    mutationFn: async ({ receiptIds, folderId }) => {
      for (const id of receiptIds) {
        await base44.entities.Receipt.update(id, { 
          folder_id: folderId || undefined 
        });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['receipts'] });
      setSelectedIds([]);
      setShowMoveDialog(false);
    },
  });

  // Calculate stats - filtered by current folder
  const stats = useMemo(() => {
    // Use receipts filtered by folder
    const folderReceipts = currentFolderId !== null 
      ? receipts.filter(r => r.folder_id === currentFolderId)
      : receipts;

    const now = new Date();
    const thisMonth = folderReceipts.filter(r => {
      if (!r.receipt_date) return false;
      const date = new Date(r.receipt_date);
      return date >= startOfMonth(now) && date <= endOfMonth(now);
    });

    const totalVAT = folderReceipts.reduce((sum, r) => sum + (r.vat_amount || 0), 0);
    const thisMonthVAT = thisMonth.reduce((sum, r) => sum + (r.vat_amount || 0), 0);
    const totalAmount = folderReceipts.reduce((sum, r) => sum + (r.total_amount || 0), 0);
    const needsReview = folderReceipts.filter(r => r.needs_review && !r.is_reviewed).length;
    const uniqueVendors = new Set(folderReceipts.map(r => r.vendor_name)).size;

    return {
      totalReceipts: folderReceipts.length,
      totalVAT,
      thisMonthVAT,
      totalAmount,
      needsReview,
      uniqueVendors
    };
  }, [receipts, currentFolderId]);

  // Filter receipts
  const filteredReceipts = useMemo(() => {
    let filtered = [...receipts];

    // Folder filter
    if (currentFolderId !== null) {
      filtered = filtered.filter(r => r.folder_id === currentFolderId);
    }

    // Search filter
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(r => 
        r.vendor_name?.toLowerCase().includes(query) ||
        r.file_name?.toLowerCase().includes(query) ||
        r.country?.toLowerCase().includes(query)
      );
    }

    // Status filter
    if (statusFilter !== 'all') {
      filtered = filtered.filter(r => r.status === statusFilter);
    }

    // Date filter
    const now = new Date();
    if (dateFilter === 'this_month') {
      filtered = filtered.filter(r => {
        if (!r.receipt_date) return false;
        const date = new Date(r.receipt_date);
        return date >= startOfMonth(now) && date <= endOfMonth(now);
      });
    } else if (dateFilter === 'last_month') {
      filtered = filtered.filter(r => {
        if (!r.receipt_date) return false;
        const date = new Date(r.receipt_date);
        const lastMonthStart = startOfMonth(subMonths(now, 1));
        const lastMonthEnd = endOfMonth(subMonths(now, 1));
        return date >= lastMonthStart && date <= lastMonthEnd;
      });
    } else if (dateFilter === 'last_3_months') {
      filtered = filtered.filter(r => {
        if (!r.receipt_date) return false;
        const date = new Date(r.receipt_date);
        return date >= startOfMonth(subMonths(now, 3));
      });
    }

    // Sort
    filtered.sort((a, b) => {
      let aVal = a[sortField];
      let bVal = b[sortField];
      
      if (sortField === 'receipt_date' || sortField === 'created_date') {
        aVal = aVal ? new Date(aVal).getTime() : 0;
        bVal = bVal ? new Date(bVal).getTime() : 0;
      }
      
      if (sortDirection === 'asc') {
        return aVal > bVal ? 1 : -1;
      }
      return aVal < bVal ? 1 : -1;
    });

    return filtered;
  }, [receipts, currentFolderId, searchQuery, statusFilter, dateFilter, sortField, sortDirection]);

  const getCurrentFolderName = () => {
    if (currentFolderId === null) return 'All Receipts';
    const folder = folders.find(f => f.id === currentFolderId);
    return folder ? folder.name : 'All Receipts';
  };

  const toggleFolder = (folderId) => {
    setExpandedFolders(prev => 
      prev.includes(folderId) 
        ? prev.filter(id => id !== folderId)
        : [...prev, folderId]
    );
  };

  const handleSort = (field) => {
    if (sortField === field) {
      setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('desc');
    }
  };

  const handleDeleteSelected = async () => {
    if (selectedIds.length === 0) return;
    if (!confirm(`Delete ${selectedIds.length} receipt(s)?`)) return;
    await deleteReceiptsMutation.mutateAsync(selectedIds);
  };

  const handleDeleteAll = async () => {
    if (receipts.length === 0) return;
    if (!confirm(`Delete ALL ${receipts.length} receipts? This action cannot be undone.`)) return;
    const allIds = receipts.map(r => r.id);
    await deleteReceiptsMutation.mutateAsync(allIds);
  };

  const handleMoveToFolder = (folderId) => {
    moveReceiptsMutation.mutate({ 
      receiptIds: selectedIds, 
      folderId 
    });
  };

  const formatCurrency = (amount) => `£${(amount || 0).toFixed(2)}`;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100">
      <div className="max-w-7xl mx-auto px-6 py-8">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shadow-lg">
              <Building2 className="w-8 h-8 text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-slate-800">Receipt Dashboard</h1>
              <p className="text-slate-500">{getCurrentFolderName()}</p>
            </div>
          </div>
          <div className="flex gap-3">
            {selectedIds.length > 0 && (
              <>
                <Button 
                  variant="outline" 
                  className="gap-2"
                  onClick={() => setShowMoveDialog(true)}
                >
                  <Folder className="w-4 h-4" />
                  Move to Folder ({selectedIds.length})
                </Button>
                <Button 
                  variant="outline" 
                  className="gap-2 text-red-600 hover:bg-red-50 border-red-200"
                  onClick={handleDeleteSelected}
                  disabled={deleteReceiptsMutation.isPending}
                >
                  <Trash2 className="w-4 h-4" />
                  Delete ({selectedIds.length})
                </Button>
              </>
            )}
            {receipts.length > 0 && (
              <Button 
                variant="outline" 
                className="gap-2 text-red-600 hover:bg-red-50 border-red-200"
                onClick={handleDeleteAll}
                disabled={deleteReceiptsMutation.isPending}
              >
                <Trash2 className="w-4 h-4" />
                Delete All
              </Button>
            )}
            <Link to={createPageUrl('Reports')}>
              <Button variant="outline" className="gap-2">
                <Download className="w-4 h-4" />
                Export
              </Button>
            </Link>
            <Link to={createPageUrl('Upload')}>
              <Button className="bg-indigo-600 hover:bg-indigo-700 gap-2">
                <Upload className="w-4 h-4" />
                Upload Receipts
              </Button>
            </Link>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          <StatsCard
            title="Total Receipts"
            value={stats.totalReceipts}
            icon={FileText}
            color="indigo"
            index={0}
          />
          <StatsCard
            title="Total VAT"
            value={formatCurrency(stats.totalVAT)}
            subtitle={`This month: ${formatCurrency(stats.thisMonthVAT)}`}
            icon={Percent}
            color="emerald"
            index={1}
          />
          <StatsCard
            title="Total Spend"
            value={formatCurrency(stats.totalAmount)}
            icon={Coins}
            color="blue"
            index={2}
          />
          <StatsCard
            title="Needs Review"
            value={stats.needsReview}
            subtitle={`${stats.uniqueVendors} vendors`}
            icon={AlertCircle}
            color={stats.needsReview > 0 ? 'amber' : 'emerald'}
            index={3}
          />
        </div>

        {/* Layout with Sidebar */}
        <div className="flex gap-6 mb-6">
          {/* Folder Sidebar */}
          <motion.div
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            className="w-64 bg-white rounded-xl border border-slate-200 p-4 h-fit"
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-slate-800 text-sm">Folders</h3>
              <FolderManager folders={folders} currentFolderId={currentFolderId} />
            </div>

            <button
              onClick={() => setCurrentFolderId(null)}
              className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg mb-2 transition-colors ${
                currentFolderId === null ? 'bg-indigo-50 text-indigo-700' : 'hover:bg-slate-50'
              }`}
            >
              <Building2 className="w-4 h-4" />
              <span className="text-sm font-medium">All Receipts</span>
              <Badge variant="outline" className="ml-auto text-xs">
                {receipts.length}
              </Badge>
            </button>

            <div className="border-t border-slate-200 pt-3 mt-3">
              <FolderTree
                folders={folders}
                receipts={receipts}
                currentFolderId={currentFolderId}
                onSelectFolder={setCurrentFolderId}
                expandedFolders={expandedFolders}
                onToggleFolder={toggleFolder}
                onDeleteFolder={(id) => deleteFolderMutation.mutate(id)}
                onRenameFolder={(id, name) => renameFolderMutation.mutate({ folderId: id, name })}
              />
            </div>
          </motion.div>

          {/* Main Content */}
          <div className="flex-1">
            {/* Filters */}
            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 }}
              className="bg-white rounded-xl border border-slate-200 p-4 mb-6"
            >
          <div className="flex flex-col md:flex-row gap-4">
            <div className="flex-1 relative">
              <Search className="w-5 h-5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <Input
                placeholder="Search vendors, files..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10"
              />
            </div>
            <div className="flex gap-3">
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-36">
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Status</SelectItem>
                  <SelectItem value="extracted">Extracted</SelectItem>
                  <SelectItem value="reviewed">Reviewed</SelectItem>
                  <SelectItem value="error">Error</SelectItem>
                </SelectContent>
              </Select>
              <Select value={dateFilter} onValueChange={setDateFilter}>
                <SelectTrigger className="w-40">
                  <SelectValue placeholder="Date range" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Time</SelectItem>
                  <SelectItem value="this_month">This Month</SelectItem>
                  <SelectItem value="last_month">Last Month</SelectItem>
                  <SelectItem value="last_3_months">Last 3 Months</SelectItem>
                </SelectContent>
              </Select>
              <div className="flex border border-slate-200 rounded-lg overflow-hidden">
                <button
                  onClick={() => setViewMode('grid')}
                  className={`p-2 ${viewMode === 'grid' ? 'bg-slate-100' : 'hover:bg-slate-50'}`}
                >
                  <Grid className="w-5 h-5 text-slate-600" />
                </button>
                <button
                  onClick={() => setViewMode('table')}
                  className={`p-2 ${viewMode === 'table' ? 'bg-slate-100' : 'hover:bg-slate-50'}`}
                >
                  <List className="w-5 h-5 text-slate-600" />
                </button>
              </div>
            </div>
          </div>
        </motion.div>

        {/* Results Count */}
        <div className="flex items-center justify-between mb-4">
          <p className="text-sm text-slate-500">
            Showing {filteredReceipts.length} of {receipts.length} receipts
          </p>
        </div>

        {/* Content */}
        {isLoading ? (
          <div className="flex items-center justify-center h-64">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600" />
          </div>
        ) : filteredReceipts.length === 0 ? (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="bg-white rounded-xl border border-slate-200 p-12 text-center"
          >
            <div className="w-16 h-16 rounded-2xl bg-slate-100 flex items-center justify-center mx-auto mb-4">
              <FileText className="w-8 h-8 text-slate-400" />
            </div>
            <h3 className="text-lg font-semibold text-slate-800 mb-2">No receipts found</h3>
            <p className="text-slate-500 mb-6">
              {receipts.length === 0 
                ? 'Upload your first receipt to get started'
                : currentFolderId !== null
                ? 'This folder is empty. Move receipts here or upload new ones.'
                : 'Try adjusting your filters'}
            </p>
            <div className="flex gap-3 justify-center">
              {currentFolderId !== null && receipts.length > 0 && (
                <Button 
                  variant="outline"
                  onClick={() => {
                    // Select all receipts from other folders/root
                    const otherReceipts = receipts.filter(r => r.folder_id !== currentFolderId);
                    setSelectedIds(otherReceipts.map(r => r.id));
                    setShowMoveDialog(true);
                  }}
                  className="gap-2"
                >
                  <Folder className="w-4 h-4" />
                  Add Existing Receipts
                </Button>
              )}
              <Link to={createPageUrl('Upload')}>
                <Button className="bg-indigo-600 hover:bg-indigo-700 gap-2">
                  <Upload className="w-4 h-4" />
                  Upload Receipts
                </Button>
              </Link>
            </div>
          </motion.div>
        ) : viewMode === 'grid' ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredReceipts.map((receipt, index) => (
              <ReceiptCard
                key={receipt.id}
                receipt={receipt}
                onView={setSelectedReceipt}
                onDelete={async (id) => {
                  await deleteReceiptsMutation.mutateAsync([id]);
                }}
                index={index}
              />
            ))}
          </div>
        ) : (
          <ReceiptTable
            receipts={filteredReceipts}
            onView={setSelectedReceipt}
            sortField={sortField}
            sortDirection={sortDirection}
            onSort={handleSort}
            selectedIds={selectedIds}
            onSelectionChange={setSelectedIds}
          />
        )}

            {/* Detail Modal */}
            <ReceiptDetailModal
              receipt={selectedReceipt}
              isOpen={!!selectedReceipt}
              onClose={() => setSelectedReceipt(null)}
            />

            {/* Move to Folder Dialog */}
            <MoveToFolderDialog
              isOpen={showMoveDialog}
              onClose={() => setShowMoveDialog(false)}
              folders={folders}
              onMove={handleMoveToFolder}
              receiptCount={selectedIds.length}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
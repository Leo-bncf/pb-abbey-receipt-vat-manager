import React, { useState, useMemo } from 'react';
import { motion } from 'framer-motion';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { 
  FileText, Upload, Coins, Percent, Building2, 
  TrendingUp, AlertCircle, Download, Filter, 
  Grid, List, Search, Calendar
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
import { format, startOfMonth, endOfMonth, subMonths, parseISO } from 'date-fns';

export default function Dashboard() {
  const [viewMode, setViewMode] = useState('grid');
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [dateFilter, setDateFilter] = useState('all');
  const [selectedReceipt, setSelectedReceipt] = useState(null);
  const [sortField, setSortField] = useState('created_date');
  const [sortDirection, setSortDirection] = useState('desc');

  const { data: receipts = [], isLoading } = useQuery({
    queryKey: ['receipts'],
    queryFn: () => base44.entities.Receipt.list('-created_date'),
  });

  // Calculate stats
  const stats = useMemo(() => {
    const now = new Date();
    const thisMonth = receipts.filter(r => {
      if (!r.receipt_date) return false;
      const date = new Date(r.receipt_date);
      return date >= startOfMonth(now) && date <= endOfMonth(now);
    });

    const lastMonth = receipts.filter(r => {
      if (!r.receipt_date) return false;
      const date = new Date(r.receipt_date);
      const lastMonthStart = startOfMonth(subMonths(now, 1));
      const lastMonthEnd = endOfMonth(subMonths(now, 1));
      return date >= lastMonthStart && date <= lastMonthEnd;
    });

    const totalVAT = receipts.reduce((sum, r) => sum + (r.vat_amount || 0), 0);
    const thisMonthVAT = thisMonth.reduce((sum, r) => sum + (r.vat_amount || 0), 0);
    const totalAmount = receipts.reduce((sum, r) => sum + (r.total_amount || 0), 0);
    const needsReview = receipts.filter(r => r.needs_review && !r.is_reviewed).length;
    const uniqueVendors = new Set(receipts.map(r => r.vendor_name)).size;

    return {
      totalReceipts: receipts.length,
      totalVAT,
      thisMonthVAT,
      totalAmount,
      needsReview,
      uniqueVendors
    };
  }, [receipts]);

  // Filter receipts
  const filteredReceipts = useMemo(() => {
    let filtered = [...receipts];

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
  }, [receipts, searchQuery, statusFilter, dateFilter, sortField, sortDirection]);

  const handleSort = (field) => {
    if (sortField === field) {
      setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('desc');
    }
  };

  const formatCurrency = (amount) => `£${(amount || 0).toFixed(2)}`;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100">
      <div className="max-w-7xl mx-auto px-6 py-8">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
          <div>
            <h1 className="text-2xl font-bold text-slate-800">Receipt Dashboard</h1>
            <p className="text-slate-500">Manage and track your business receipts</p>
          </div>
          <div className="flex gap-3">
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
                : 'Try adjusting your filters'}
            </p>
            <Link to={createPageUrl('Upload')}>
              <Button className="bg-indigo-600 hover:bg-indigo-700 gap-2">
                <Upload className="w-4 h-4" />
                Upload Receipts
              </Button>
            </Link>
          </motion.div>
        ) : viewMode === 'grid' ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredReceipts.map((receipt, index) => (
              <ReceiptCard
                key={receipt.id}
                receipt={receipt}
                onView={setSelectedReceipt}
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
            selectedIds={[]}
            onSelectionChange={() => {}}
          />
        )}

        {/* Detail Modal */}
        <ReceiptDetailModal
          receipt={selectedReceipt}
          isOpen={!!selectedReceipt}
          onClose={() => setSelectedReceipt(null)}
        />
      </div>
    </div>
  );
}
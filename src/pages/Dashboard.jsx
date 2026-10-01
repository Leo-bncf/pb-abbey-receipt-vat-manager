import React, { useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Upload, Download, Search, Trash2, Eye, ChevronUp, ChevronDown, FileText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { base44 } from '@/api/base44Client';
import { createPageUrl } from '@/utils';
import AppShell, { StatTile } from '@/components/AppShell';
import ReceiptDetailModal from '../components/receipts/ReceiptDetailModal';
import { startOfMonth, endOfMonth, subMonths, format } from 'date-fns';

const gbp = (n) => `£${(Number(n) || 0).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const statusChip = {
  reviewed: 'text-emerald-700 bg-emerald-50 border-emerald-200',
  extracted: 'text-stone-600 bg-stone-100 border-stone-200',
  error: 'text-red-700 bg-red-50 border-red-200',
  uploaded: 'text-stone-500 bg-stone-50 border-stone-200',
  processing: 'text-amber-700 bg-amber-50 border-amber-200',
};

export default function Dashboard() {
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [dateFilter, setDateFilter] = useState('all');
  const [folderFilter, setFolderFilter] = useState('all');
  const [selectedReceipt, setSelectedReceipt] = useState(null);
  const [sortField, setSortField] = useState('receipt_date');
  const [sortDirection, setSortDirection] = useState('desc');
  const [selectedIds, setSelectedIds] = useState([]);

  const qc = useQueryClient();
  const { data: receipts = [], isLoading } = useQuery({ queryKey: ['receipts'], queryFn: () => base44.entities.Receipt.list('-created_date') });
  const { data: folders = [] } = useQuery({ queryKey: ['folders'], queryFn: () => base44.entities.Folder.list('name') });

  const del = useMutation({
    mutationFn: async (ids) => { for (const id of ids) await base44.entities.Receipt.delete(id); },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['receipts'] }); setSelectedIds([]); },
  });

  const scoped = useMemo(() => (folderFilter === 'all' ? receipts : folderFilter === 'root' ? receipts.filter((r) => !r.folder_id) : receipts.filter((r) => r.folder_id === folderFilter)), [receipts, folderFilter]);

  const stats = useMemo(() => {
    const now = new Date();
    const totalVAT = scoped.reduce((s, r) => s + (r.vat_amount || 0), 0);
    const totalAmount = scoped.reduce((s, r) => s + (r.total_amount || 0), 0);
    const thisMonthVAT = scoped.filter((r) => r.receipt_date && new Date(r.receipt_date) >= startOfMonth(now) && new Date(r.receipt_date) <= endOfMonth(now)).reduce((s, r) => s + (r.vat_amount || 0), 0);
    return { count: scoped.length, totalVAT, totalAmount, thisMonthVAT, vendors: new Set(scoped.map((r) => r.vendor_name)).size };
  }, [scoped]);

  const rows = useMemo(() => {
    let f = [...scoped];
    if (searchQuery) { const q = searchQuery.toLowerCase(); f = f.filter((r) => r.vendor_name?.toLowerCase().includes(q) || r.file_name?.toLowerCase().includes(q) || r.country?.toLowerCase().includes(q)); }
    if (statusFilter === 'needs_review') f = f.filter((r) => r.needs_review && !r.is_reviewed);
    else if (statusFilter !== 'all') f = f.filter((r) => r.status === statusFilter);
    const now = new Date();
    if (dateFilter === 'this_month') f = f.filter((r) => r.receipt_date && new Date(r.receipt_date) >= startOfMonth(now) && new Date(r.receipt_date) <= endOfMonth(now));
    else if (dateFilter === 'last_month') f = f.filter((r) => r.receipt_date && new Date(r.receipt_date) >= startOfMonth(subMonths(now, 1)) && new Date(r.receipt_date) <= endOfMonth(subMonths(now, 1)));
    else if (dateFilter === 'last_3_months') f = f.filter((r) => r.receipt_date && new Date(r.receipt_date) >= startOfMonth(subMonths(now, 3)));
    f.sort((a, b) => {
      let av = a[sortField], bv = b[sortField];
      if (sortField.endsWith('_date')) { av = av ? new Date(av).getTime() : 0; bv = bv ? new Date(bv).getTime() : 0; }
      if (av == null) av = ''; if (bv == null) bv = '';
      return (sortDirection === 'asc' ? 1 : -1) * (av > bv ? 1 : av < bv ? -1 : 0);
    });
    return f;
  }, [scoped, searchQuery, statusFilter, dateFilter, sortField, sortDirection]);

  const sort = (field) => { if (sortField === field) setSortDirection((d) => (d === 'asc' ? 'desc' : 'asc')); else { setSortField(field); setSortDirection('desc'); } };
  const toggleAll = (c) => setSelectedIds(c ? rows.map((r) => r.id) : []);
  const toggleOne = (id, c) => setSelectedIds((s) => (c ? [...s, id] : s.filter((i) => i !== id)));
  const delSelected = async () => { if (selectedIds.length && confirm(`Delete ${selectedIds.length} receipt(s)?`)) await del.mutateAsync(selectedIds); };

  const Th = ({ field, children, right }) => (
    <th className={`px-5 py-3 text-[11px] uppercase tracking-[0.12em] font-medium text-stone-400 ${right ? 'text-right' : 'text-left'}`}>
      {field ? (
        <button onClick={() => sort(field)} className={`inline-flex items-center gap-1 hover:text-stone-900 ${right ? 'flex-row-reverse' : ''}`}>
          {children}{sortField === field && (sortDirection === 'asc' ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />)}
        </button>
      ) : children}
    </th>
  );

  const actions = (
    <>
      {selectedIds.length > 0 && (
        <Button variant="outline" className="gap-2 border-red-200 text-red-600 hover:bg-red-50" onClick={delSelected} disabled={del.isPending}>
          <Trash2 className="w-4 h-4" /> Delete ({selectedIds.length})
        </Button>
      )}
      <Link to={createPageUrl('Reports')}><Button variant="outline" className="gap-2 border-stone-300"><Download className="w-4 h-4" /> Export</Button></Link>
      <Link to={createPageUrl('Upload')}><Button className="gap-2 bg-stone-950 hover:bg-stone-800"><Upload className="w-4 h-4" /> Upload</Button></Link>
    </>
  );

  return (
    <AppShell title="Receipts" subtitle={`${stats.count} receipts · ${stats.vendors} vendors`} actions={actions}>
      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        <StatTile label="Total spend" value={gbp(stats.totalAmount)} />
        <StatTile label="Total VAT" value={gbp(stats.totalVAT)} />
        <StatTile label="VAT this month" value={gbp(stats.thisMonthVAT)} />
        <StatTile label="Receipts" value={stats.count} sub={`${stats.vendors} vendors`} />
      </div>

      {/* Filters */}
      <div className="flex flex-col md:flex-row gap-3 mb-5">
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-stone-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <Input placeholder="Search vendor, file, country…" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="pl-9 bg-white border-stone-900/10" />
        </div>
        <Select value={folderFilter} onValueChange={setFolderFilter}>
          <SelectTrigger className="w-44 bg-white border-stone-900/10"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All folders</SelectItem>
            {folders.map((f) => <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>)}
            <SelectItem value="root">No folder</SelectItem>
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-40 bg-white border-stone-900/10"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All status</SelectItem>
            <SelectItem value="needs_review">Needs review</SelectItem>
            <SelectItem value="extracted">Extracted</SelectItem>
            <SelectItem value="reviewed">Reviewed</SelectItem>
            <SelectItem value="error">Error</SelectItem>
          </SelectContent>
        </Select>
        <Select value={dateFilter} onValueChange={setDateFilter}>
          <SelectTrigger className="w-40 bg-white border-stone-900/10"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All time</SelectItem>
            <SelectItem value="this_month">This month</SelectItem>
            <SelectItem value="last_month">Last month</SelectItem>
            <SelectItem value="last_3_months">Last 3 months</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Dense table */}
      <div className="bg-white border border-stone-900/10 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-stone-900/10">
              <tr>
                <th className="px-5 py-3 w-10"><Checkbox checked={selectedIds.length === rows.length && rows.length > 0} onCheckedChange={toggleAll} /></th>
                <Th field="receipt_date">Date</Th>
                <Th field="vendor_name">Vendor</Th>
                <Th>Country</Th>
                <Th field="total_amount" right>Total</Th>
                <Th right>VAT</Th>
                <Th>Status</Th>
                <Th right>Conf.</Th>
                <th className="px-5 py-3 w-10"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-900/5">
              {isLoading ? (
                <tr><td colSpan={9} className="px-5 py-16 text-center text-stone-400">Loading…</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={9} className="px-5 py-16 text-center text-stone-400">No receipts found</td></tr>
              ) : rows.map((r) => (
                <tr key={r.id} className="hover:bg-stone-50/70">
                  <td className="px-5 py-3"><Checkbox checked={selectedIds.includes(r.id)} onCheckedChange={(c) => toggleOne(r.id, c)} /></td>
                  <td className="px-5 py-3 text-stone-500 whitespace-nowrap">{r.receipt_date ? format(new Date(r.receipt_date), 'dd/MM/yyyy') : '—'}</td>
                  <td className="px-5 py-3">
                    <div className="font-medium text-stone-900">{r.vendor_name || 'Unknown'}</div>
                    <div className="text-xs text-stone-400 truncate max-w-[220px]">{r.file_name}</div>
                  </td>
                  <td className="px-5 py-3 text-stone-500">{r.country || '—'}</td>
                  <td className="px-5 py-3 text-right tabular-nums font-semibold text-stone-900">{gbp(r.total_amount)}</td>
                  <td className="px-5 py-3 text-right tabular-nums text-stone-500">{gbp(r.vat_amount)}{r.vat_rate ? <span className="text-stone-300"> · {Math.round(r.vat_rate)}%</span> : ''}</td>
                  <td className="px-5 py-3"><span className={`inline-block px-2.5 py-0.5 rounded-full text-xs border ${statusChip[r.status] || statusChip.uploaded}`}>{r.needs_review && !r.is_reviewed ? 'review' : r.status}</span></td>
                  <td className="px-5 py-3 text-right tabular-nums text-stone-400">{r.confidence_score != null ? `${Math.round(r.confidence_score)}%` : '—'}</td>
                  <td className="px-5 py-3 text-right">
                    <button onClick={() => setSelectedReceipt(r)} className="text-stone-400 hover:text-stone-900"><Eye className="w-4 h-4" /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <ReceiptDetailModal receipt={selectedReceipt} isOpen={!!selectedReceipt} onClose={() => setSelectedReceipt(null)} />
    </AppShell>
  );
}

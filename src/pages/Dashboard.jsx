import React, { useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Upload, Download, Search, Trash2, Eye, ChevronUp, ChevronDown,
  Folder, FolderPlus, ChevronRight, FileText, ArrowLeft, Pencil,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { base44 } from '@/api/base44Client';
import { createPageUrl } from '@/utils';
import AppShell, { StatTile } from '@/components/AppShell';
import ReceiptDetailModal from '../components/receipts/ReceiptDetailModal';
import { format } from 'date-fns';

const gbp = (n) => `£${(Number(n) || 0).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const statusChip = {
  reviewed: 'text-emerald-700 bg-emerald-50 border-emerald-200',
  extracted: 'text-slate-600 bg-slate-100 border-slate-200',
  error: 'text-red-700 bg-red-50 border-red-200',
  uploaded: 'text-slate-500 bg-slate-50 border-slate-200',
  processing: 'text-amber-700 bg-amber-50 border-amber-200',
};

export default function Dashboard() {
  const [currentFolderId, setCurrentFolderId] = useState(null); // null = root (explorer)
  const [searchQuery, setSearchQuery] = useState('');
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
  const createFolder = useMutation({
    mutationFn: (name) => base44.entities.Folder.create({ name }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['folders'] }),
  });
  const renameFolder = useMutation({
    mutationFn: ({ id, name }) => base44.entities.Folder.update(id, { name }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['folders'] }),
  });
  const deleteFolder = useMutation({
    mutationFn: (id) => base44.entities.Folder.delete(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['folders'] }); setCurrentFolderId(null); },
  });

  const isRoot = currentFolderId === null;
  const currentFolder = folders.find((f) => f.id === currentFolderId);

  // Folders with their receipt counts/totals (for the explorer tiles)
  const folderCards = useMemo(() => folders.map((f) => {
    const rs = receipts.filter((r) => r.folder_id === f.id);
    return { ...f, count: rs.length, total: rs.reduce((s, r) => s + (r.total_amount || 0), 0) };
  }), [folders, receipts]);

  const rootReceipts = useMemo(() => receipts.filter((r) => !r.folder_id), [receipts]);

  // Receipts shown in the current view (a folder, or root loose receipts)
  const inScope = useMemo(() => (isRoot ? rootReceipts : receipts.filter((r) => r.folder_id === currentFolderId)), [isRoot, rootReceipts, receipts, currentFolderId]);

  const stats = useMemo(() => {
    const base = isRoot ? receipts : inScope; // root stats = whole account
    return {
      count: base.length,
      total: base.reduce((s, r) => s + (r.total_amount || 0), 0),
      vat: base.reduce((s, r) => s + (r.vat_amount || 0), 0),
      vendors: new Set(base.map((r) => r.vendor_name)).size,
    };
  }, [isRoot, receipts, inScope]);

  const rows = useMemo(() => {
    let f = [...inScope];
    if (searchQuery) { const q = searchQuery.toLowerCase(); f = f.filter((r) => r.vendor_name?.toLowerCase().includes(q) || r.file_name?.toLowerCase().includes(q) || r.country?.toLowerCase().includes(q)); }
    f.sort((a, b) => {
      let av = a[sortField], bv = b[sortField];
      if (sortField.endsWith('_date')) { av = av ? new Date(av).getTime() : 0; bv = bv ? new Date(bv).getTime() : 0; }
      if (av == null) av = ''; if (bv == null) bv = '';
      return (sortDirection === 'asc' ? 1 : -1) * (av > bv ? 1 : av < bv ? -1 : 0);
    });
    return f;
  }, [inScope, searchQuery, sortField, sortDirection]);

  const sort = (field) => { if (sortField === field) setSortDirection((d) => (d === 'asc' ? 'desc' : 'asc')); else { setSortField(field); setSortDirection('desc'); } };
  const toggleAll = (c) => setSelectedIds(c ? rows.map((r) => r.id) : []);
  const toggleOne = (id, c) => setSelectedIds((s) => (c ? [...s, id] : s.filter((i) => i !== id)));
  const delSelected = async () => { if (selectedIds.length && confirm(`Delete ${selectedIds.length} receipt(s)?`)) await del.mutateAsync(selectedIds); };
  const newFolder = () => { const n = prompt('New folder name:'); if (n && n.trim()) createFolder.mutate(n.trim()); };

  const Th = ({ field, children, right }) => (
    <th className={`px-4 py-2.5 text-xs font-semibold text-slate-500 ${right ? 'text-right' : 'text-left'}`}>
      {field ? (
        <button onClick={() => sort(field)} className={`inline-flex items-center gap-1 hover:text-slate-800 ${right ? 'flex-row-reverse' : ''}`}>
          {children}{sortField === field && (sortDirection === 'asc' ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />)}
        </button>
      ) : children}
    </th>
  );

  const Table = () => (
    <div className="bg-white border border-slate-200 rounded-lg overflow-hidden shadow-sm">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              <th className="px-4 py-2.5 w-10"><Checkbox checked={selectedIds.length === rows.length && rows.length > 0} onCheckedChange={toggleAll} /></th>
              <Th field="receipt_date">Date</Th>
              <Th field="vendor_name">Vendor</Th>
              <Th>Country</Th>
              <Th field="total_amount" right>Total</Th>
              <Th right>VAT</Th>
              <Th>Status</Th>
              <Th right>Conf.</Th>
              <th className="px-4 py-2.5 w-10"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {isLoading ? (
              <tr><td colSpan={9} className="px-4 py-16 text-center text-slate-400">Loading…</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={9} className="px-4 py-16 text-center text-slate-400">No receipts here</td></tr>
            ) : rows.map((r) => (
              <tr key={r.id} className="hover:bg-slate-50">
                <td className="px-4 py-2.5"><Checkbox checked={selectedIds.includes(r.id)} onCheckedChange={(c) => toggleOne(r.id, c)} /></td>
                <td className="px-4 py-2.5 text-slate-500 whitespace-nowrap">{r.receipt_date ? format(new Date(r.receipt_date), 'dd/MM/yyyy') : '—'}</td>
                <td className="px-4 py-2.5">
                  <div className="font-medium text-slate-800">{r.vendor_name || 'Unknown'}</div>
                  <div className="text-xs text-slate-400 truncate max-w-[220px]">{r.file_name}</div>
                </td>
                <td className="px-4 py-2.5 text-slate-500">{r.country || '—'}</td>
                <td className="px-4 py-2.5 text-right tabular-nums font-semibold text-slate-900">{gbp(r.total_amount)}</td>
                <td className="px-4 py-2.5 text-right tabular-nums text-slate-500">{gbp(r.vat_amount)}{r.vat_rate ? <span className="text-slate-300"> · {Math.round(r.vat_rate)}%</span> : ''}</td>
                <td className="px-4 py-2.5"><span className={`inline-block px-2 py-0.5 rounded text-xs border ${statusChip[r.status] || statusChip.uploaded}`}>{r.needs_review && !r.is_reviewed ? 'review' : r.status}</span></td>
                <td className="px-4 py-2.5 text-right tabular-nums text-slate-400">{r.confidence_score != null ? `${Math.round(r.confidence_score)}%` : '—'}</td>
                <td className="px-4 py-2.5 text-right"><button onClick={() => setSelectedReceipt(r)} className="text-slate-400 hover:text-brand"><Eye className="w-4 h-4" /></button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );

  const actions = (
    <>
      {selectedIds.length > 0 && (
        <Button variant="outline" className="gap-2 border-red-200 text-red-600 hover:bg-red-50" onClick={delSelected} disabled={del.isPending}>
          <Trash2 className="w-4 h-4" /> Delete ({selectedIds.length})
        </Button>
      )}
      {isRoot && <Button variant="outline" className="gap-2" onClick={newFolder}><FolderPlus className="w-4 h-4" /> New folder</Button>}
      <Link to={createPageUrl('Reports')}><Button variant="outline" className="gap-2"><Download className="w-4 h-4" /> Export</Button></Link>
      <Link to={createPageUrl('Upload')}><Button className="gap-2 bg-brand hover:opacity-90 text-white"><Upload className="w-4 h-4" /> Upload</Button></Link>
    </>
  );

  return (
    <AppShell title="Documents" subtitle={`${stats.count} receipts · ${gbp(stats.total)} · VAT ${gbp(stats.vat)}`} actions={actions}>
      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <StatTile label="Total spend" value={gbp(stats.total)} />
        <StatTile label="Total VAT" value={gbp(stats.vat)} />
        <StatTile label="Receipts" value={stats.count} />
        <StatTile label="Vendors" value={stats.vendors} />
      </div>

      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm mb-4">
        <button onClick={() => { setCurrentFolderId(null); setSelectedIds([]); }} className={`inline-flex items-center gap-1.5 ${isRoot ? 'text-slate-900 font-medium' : 'text-slate-500 hover:text-slate-900'}`}>
          <Folder className="w-4 h-4" /> All documents
        </button>
        {!isRoot && (
          <>
            <ChevronRight className="w-4 h-4 text-slate-300" />
            <span className="text-slate-900 font-medium">{currentFolder?.name || 'Folder'}</span>
            <button onClick={() => { const n = prompt('Rename folder:', currentFolder?.name); if (n && n.trim()) renameFolder.mutate({ id: currentFolderId, name: n.trim() }); }} className="ml-1 text-slate-400 hover:text-slate-700"><Pencil className="w-3.5 h-3.5" /></button>
          </>
        )}
      </div>

      {/* Search */}
      <div className="relative mb-5 max-w-md">
        <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
        <Input placeholder="Search vendor, file, country…" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="pl-9 bg-white" />
      </div>

      {/* ROOT: folder explorer + loose receipts. FOLDER: just the table */}
      {isRoot && !searchQuery && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 mb-8">
            {folderCards.map((f) => (
              <button key={f.id} onClick={() => { setCurrentFolderId(f.id); setSelectedIds([]); }}
                className="group flex items-center gap-3 bg-white border border-slate-200 rounded-lg p-4 text-left hover:border-brand hover:shadow-sm transition-all">
                <div className="w-10 h-10 rounded-lg bg-brand/10 flex items-center justify-center shrink-0">
                  <Folder className="w-5 h-5 text-brand" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="font-medium text-slate-800 truncate">{f.name}</div>
                  <div className="text-xs text-slate-400">{f.count} receipt{f.count !== 1 ? 's' : ''} · {gbp(f.total)}</div>
                </div>
                <ChevronRight className="w-4 h-4 text-slate-300 group-hover:text-brand" />
              </button>
            ))}
            {folderCards.length === 0 && <p className="text-sm text-slate-400">No folders yet — create one to organise receipts.</p>}
          </div>
          {rootReceipts.length > 0 && (
            <>
              <h2 className="text-sm font-semibold text-slate-500 mb-3">Unfiled receipts</h2>
              <Table />
            </>
          )}
        </>
      )}

      {(!isRoot || searchQuery) && (
        <>
          {!isRoot && (
            <button onClick={() => { setCurrentFolderId(null); setSelectedIds([]); }} className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-900 mb-3">
              <ArrowLeft className="w-4 h-4" /> Back to all documents
            </button>
          )}
          <Table />
          {!isRoot && currentFolder && (
            <button onClick={() => { if (confirm(`Delete folder "${currentFolder.name}"? Receipts inside stay but become unfiled.`)) deleteFolder.mutate(currentFolderId); }}
              className="mt-4 inline-flex items-center gap-1.5 text-sm text-red-500 hover:text-red-700">
              <Trash2 className="w-3.5 h-3.5" /> Delete this folder
            </button>
          )}
        </>
      )}

      <ReceiptDetailModal receipt={selectedReceipt} isOpen={!!selectedReceipt} onClose={() => setSelectedReceipt(null)} />
    </AppShell>
  );
}

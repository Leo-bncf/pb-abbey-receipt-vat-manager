import React, { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Copy, Trash2, CheckCircle, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { base44 } from '@/api/base44Client';
import { format } from 'date-fns';

// A receipt's content identity: same vendor + date + total + VAT means the same
// receipt, even if it arrived in a differently-named document. This catches
// duplicates a file-name check can't (e.g. overlapping "Part 2"/"Part 3" PDFs).
const contentKey = (r) =>
  [(r.vendor_name || '').toLowerCase().trim(), r.receipt_date || '', r.total_amount ?? '', r.vat_amount ?? ''].join('|');

export default function DuplicatesTab() {
  const queryClient = useQueryClient();
  const [deleting, setDeleting] = useState(false);

  const { data: receipts = [], isLoading } = useQuery({
    queryKey: ['receipts'],
    queryFn: () => base44.entities.Receipt.list('-created_date'),
  });

  // Group by content. Within each group, keep the earliest-created receipt and
  // mark the rest as removable duplicates.
  const groups = useMemo(() => {
    const byKey = {};
    receipts.forEach((r) => {
      const k = contentKey(r);
      (byKey[k] = byKey[k] || []).push(r);
    });
    return Object.values(byKey)
      .filter((g) => g.length > 1)
      .map((g) => {
        const sorted = [...g].sort((a, b) => new Date(a.created_date) - new Date(b.created_date));
        return { keep: sorted[0], remove: sorted.slice(1) };
      })
      .sort((a, b) => b.remove.length - a.remove.length);
  }, [receipts]);

  const removableCount = groups.reduce((s, g) => s + g.remove.length, 0);

  const deleteMutation = useMutation({
    mutationFn: async (ids) => {
      for (const id of ids) await base44.entities.Receipt.delete(id);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['receipts'] }),
  });

  const deleteIds = async (ids, label) => {
    if (ids.length === 0) return;
    if (!confirm(`Delete ${ids.length} duplicate receipt(s)${label ? ` for ${label}` : ''}? This cannot be undone.`)) return;
    setDeleting(true);
    try {
      await deleteMutation.mutateAsync(ids);
    } finally {
      setDeleting(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 text-indigo-600 animate-spin" />
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
      <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <Copy className="w-5 h-5 text-amber-600" />
          <div>
            <h3 className="font-semibold text-slate-800">Duplicate Receipts</h3>
            <p className="text-sm text-slate-500">
              Same vendor, date, amount &amp; VAT — keeps the earliest, removes the rest.
            </p>
          </div>
        </div>
        {removableCount > 0 && (
          <Button
            className="bg-red-600 hover:bg-red-700 gap-2"
            disabled={deleting}
            onClick={() => deleteIds(groups.flatMap((g) => g.remove.map((r) => r.id)))}
          >
            {deleting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
            Delete all {removableCount} duplicates
          </Button>
        )}
      </div>

      {groups.length === 0 ? (
        <div className="p-12 text-center">
          <div className="w-16 h-16 rounded-2xl bg-green-100 flex items-center justify-center mx-auto mb-4">
            <CheckCircle className="w-8 h-8 text-green-600" />
          </div>
          <h3 className="text-lg font-semibold text-slate-800 mb-1">No duplicates found</h3>
          <p className="text-slate-500">Every receipt is unique by content.</p>
        </div>
      ) : (
        <div className="divide-y divide-slate-100">
          {groups.map((g, i) => {
            const r = g.keep;
            return (
              <div key={i} className="p-4">
                <div className="flex items-center justify-between gap-4 mb-2">
                  <div className="min-w-0">
                    <span className="font-medium text-slate-800">{r.vendor_name || 'Unknown'}</span>
                    <span className="text-slate-500 text-sm">
                      {' · '}{r.receipt_date ? format(new Date(r.receipt_date), 'dd/MM/yyyy') : 'no date'}
                      {' · '}£{(r.total_amount || 0).toFixed(2)}
                      {' · VAT £'}{(r.vat_amount || 0).toFixed(2)}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Badge variant="outline" className="text-amber-700 border-amber-200 bg-amber-50">
                      {g.remove.length} duplicate{g.remove.length !== 1 ? 's' : ''}
                    </Badge>
                    <Button
                      variant="outline"
                      size="sm"
                      className="text-red-600 hover:bg-red-50 border-red-200 gap-1"
                      disabled={deleting}
                      onClick={() => deleteIds(g.remove.map((x) => x.id), r.vendor_name)}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      Remove
                    </Button>
                  </div>
                </div>
                <ul className="text-xs text-slate-500 space-y-0.5 pl-1">
                  <li className="text-green-700">
                    ✓ Keep: {g.keep.file_name} <span className="text-slate-400">({format(new Date(g.keep.created_date), 'dd/MM/yyyy HH:mm')})</span>
                  </li>
                  {g.remove.map((x) => (
                    <li key={x.id} className="text-red-600">
                      ✗ Remove: {x.file_name} <span className="text-slate-400">({format(new Date(x.created_date), 'dd/MM/yyyy HH:mm')})</span>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

import React, { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Pencil, Trash2, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { base44 } from '@/api/base44Client';
import TenantShell from './TenantShell';
import { StatStrip } from '@/components/AppShell';
import { EntityDialog, ResponsiveList, Act, chip, fmtDate } from './ui';

// UK landlord certificate types + their typical renewal cadence (years) used to
// suggest an expiry date when one isn't entered.
const TYPES = [
  { value: 'gas_safety', label: 'Gas Safety (CP12)', years: 1 },
  { value: 'eicr', label: 'EICR (electrical)', years: 5 },
  { value: 'epc', label: 'EPC (energy)', years: 10 },
  { value: 'insurance', label: 'Insurance', years: 1 },
  { value: 'deposit_protection', label: 'Deposit protection', years: null },
  { value: 'right_to_rent', label: 'Right to Rent', years: null },
  { value: 'pat', label: 'PAT (appliances)', years: 1 },
  { value: 'other', label: 'Other', years: null },
];
const typeLabel = (t) => (TYPES.find((x) => x.value === t) || {}).label || t;

const daysLeft = (expiry) => (expiry ? Math.floor((new Date(expiry) - new Date()) / 86400000) : null);
const statusOf = (expiry) => {
  const d = daysLeft(expiry);
  if (d == null) return { key: 'none', label: 'No expiry', cls: 'text-neutral-500 border-neutral-200 bg-neutral-50' };
  if (d < 0) return { key: 'expired', label: `Expired ${-d}d ago`, cls: 'text-red-700 border-red-200 bg-red-50' };
  if (d <= 60) return { key: 'soon', label: `Expires in ${d}d`, cls: 'text-amber-700 border-amber-200 bg-amber-50' };
  return { key: 'valid', label: 'Valid', cls: 'text-emerald-700 border-emerald-200 bg-emerald-50' };
};

export default function Compliance() {
  const qc = useQueryClient();
  const { data: items = [] } = useQuery({ queryKey: ['compliance'], queryFn: () => base44.entities.Compliance.list('expiry_date') });
  const { data: units = [] } = useQuery({ queryKey: ['units'], queryFn: () => base44.entities.Unit.list('reference') });
  const [dialog, setDialog] = useState(null);

  const fields = [
    { name: 'type', label: 'Certificate', type: 'select', required: true, options: TYPES.map((t) => ({ value: t.value, label: t.label })) },
    { name: 'unit_id', label: 'Property', type: 'select', options: [{ value: '', label: '— Portfolio-wide —' }, ...units.map((u) => ({ value: u.id, label: u.reference }))] },
    { name: 'issued_date', label: 'Issued', type: 'date' },
    { name: 'expiry_date', label: 'Expires', type: 'date' },
    { name: 'provider', label: 'Provider / engineer' },
    { name: 'reference', label: 'Certificate ref.' },
    { name: 'notes', label: 'Notes' },
  ];

  const save = useMutation({
    mutationFn: (v) => {
      const u = units.find((x) => x.id === v.unit_id);
      // If no expiry given but the type has a cadence and an issued date, derive it.
      let expiry = v.expiry_date;
      const cad = (TYPES.find((t) => t.value === v.type) || {}).years;
      if (!expiry && v.issued_date && cad) {
        const d = new Date(v.issued_date); d.setFullYear(d.getFullYear() + cad);
        expiry = d.toISOString().slice(0, 10);
      }
      const { id, created_date, updated_date, created_by, ...rest } = v; // never send the row's own bookkeeping back
      const payload = { ...rest, unit_id: v.unit_id || null, issued_date: v.issued_date || null, expiry_date: expiry || null, unit_reference: u ? u.reference : '' };
      return v.id ? base44.entities.Compliance.update(v.id, payload) : base44.entities.Compliance.create(payload);
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['compliance'] }); setDialog(null); },
  });
  const del = useMutation({ mutationFn: (id) => base44.entities.Compliance.delete(id), onSuccess: () => qc.invalidateQueries({ queryKey: ['compliance'] }), onError: (e) => alert(`Could not delete: ${e.message}`) });

  const stats = useMemo(() => {
    let valid = 0, soon = 0, expired = 0;
    items.forEach((i) => { const s = statusOf(i.expiry_date).key; if (s === 'expired') expired++; else if (s === 'soon') soon++; else if (s === 'valid') valid++; });
    return { valid, soon, expired };
  }, [items]);

  const actions = <Button className="gap-2 bg-neutral-900 hover:bg-neutral-800" onClick={() => { save.reset(); setDialog('new'); }}><Plus className="w-4 h-4" /> Add certificate</Button>;

  return (
    <TenantShell title="Compliance" subtitle="Landlord certificates & renewals (UK)" actions={actions}>
      <div className="mb-8">
        <StatStrip items={[
          { label: 'Valid', value: stats.valid },
          { label: 'Expiring ≤ 60 days', value: stats.soon, accent: stats.soon > 0 },
          { label: 'Expired', value: stats.expired, accent: stats.expired > 0 },
          { label: 'Tracked', value: items.length },
        ]} />
      </div>

      <ResponsiveList
        rows={items}
        onRowClick={(i) => { save.reset(); setDialog(i); }}
        empty="No certificates tracked yet. Add Gas Safety, EICR, EPC, insurance…"
        columns={[
          { label: 'Certificate', cell: (i) => typeLabel(i.type), mobile: 'title' },
          { label: 'Property', cell: (i) => i.unit_reference || 'Portfolio-wide', mobile: 'sub' },
          { label: 'Provider', cell: (i) => i.provider || '—', mobile: 'sub' },
          { label: 'Issued', cell: (i) => fmtDate(i.issued_date), mobile: 'hide' },
          { label: 'Expires', cell: (i) => fmtDate(i.expiry_date), mobile: 'meta' },
          { label: 'Status', cell: (i) => { const st = statusOf(i.expiry_date); return chip(st.cls, st.label); }, mobile: 'meta' },
        ]}
        actions={(i, m) => <>
          <Act icon={Pencil} label="Edit" mobile={m} onClick={() => { save.reset(); setDialog(i); }} />
          <Act icon={Trash2} label="Delete" tone="red" mobile={m} onClick={() => { if (confirm(`Delete this ${typeLabel(i.type)} record?`)) del.mutate(i.id); }} />
        </>}
      />

      <EntityDialog
        open={dialog !== null}
        onClose={() => setDialog(null)}
        title={dialog === 'new' ? 'Add certificate' : 'Edit certificate'}
        fields={fields}
        initial={dialog === 'new' ? { type: 'gas_safety' } : dialog}
        onSubmit={(v) => save.mutate(v)}
        submitting={save.isPending}
        error={save.error}
      />
    </TenantShell>
  );
}

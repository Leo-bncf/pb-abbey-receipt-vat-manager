/* Tenant · Units — each lettable unit, grouped by property: who rents it, for
 * how much, and its lease dates. The rent here is what "Generate rent" bills
 * each month (or quarter). */
import React, { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Pencil, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { base44 } from '@/api/base44Client';
import TenantShell from './TenantShell';
import { EntityDialog, ResponsiveList, Act, chip, fmtDate, BILLED, leaseEvents, EVENT_CHIP, whenText } from './ui';
import { Tile, TileGrid, Meter, Ring, Ranked, TONE, gbpK } from './viz';

const STATUS = {
  occupied: ['text-emerald-700 border-emerald-200 bg-emerald-50', 'let'],
  vacant: ['text-neutral-500 border-neutral-200 bg-neutral-50', 'vacant'],
};
const EDITABLE = ['reference', 'site', 'address', 'rent_amount', 'rent_frequency', 'vat_applicable', 'tenant_id', 'area_sqft',
  'lease_start', 'break_date', 'lease_end', 'next_review', 'market_rent', 'service_charge', 'sc_included', 'notes'];
const NUM = ['rent_amount', 'area_sqft', 'market_rent', 'service_charge'];
const gbp0 = (n) => `£${Math.round(Number(n) || 0).toLocaleString('en-GB')}`;

export default function Units() {
  const qc = useQueryClient();
  const { data: units = [] } = useQuery({ queryKey: ['units'], queryFn: () => base44.entities.Unit.list('reference') });
  const { data: tenants = [] } = useQuery({ queryKey: ['tenants'], queryFn: () => base44.entities.Tenant.list('name') });
  const [dialog, setDialog] = useState(null);
  const [site, setSite] = useState('');
  const [params, setParams] = useSearchParams();

  const sites = useMemo(() => [...new Set(units.map((u) => u.site).filter(Boolean))].sort(), [units]);
  const nextEvent = useMemo(() => {
    const m = {};
    for (const e of leaseEvents(units, { months: 120 })) if (!m[e.unit.id]) m[e.unit.id] = e;
    return m;
  }, [units]);
  const rows = useMemo(() => units.filter((u) => !site || u.site === site)
    .sort((a, b) => (a.site || '~').localeCompare(b.site || '~') || (a.reference || '').localeCompare(b.reference || '', 'en', { numeric: true })), [units, site]);

  const fields = [
    { name: 'reference', label: 'Unit', required: true, placeholder: 'e.g. Unit 4A', half: true },
    { name: 'site', label: 'Property', placeholder: 'e.g. Team House, Barnstaple', half: true },
    { name: 'address', label: 'Address', required: true },
    { name: 'tenant_id', label: 'Tenant', type: 'select', options: [{ value: '', label: '— vacant —' }, ...tenants.filter((t) => t.status !== 'ended').map((t) => ({ value: t.id, label: t.name }))] },
    { name: 'rent_amount', label: 'Rent per month, excl. VAT (£)', type: 'number', half: true },
    { name: 'market_rent', label: 'Market rent a year (£)', type: 'number', half: true, help: 'What it would let for today' },
    { name: 'rent_frequency', label: 'Billed', type: 'select', options: Object.entries(BILLED).map(([value, label]) => ({ value, label })) },
    { name: 'vat_applicable', label: 'Charge VAT (20%) on the rent', type: 'checkbox' },
    { name: 'lease_start', label: 'Lease starts', type: 'date', half: true },
    { name: 'lease_end', label: 'Lease ends', type: 'date', half: true },
    { name: 'break_date', label: 'Tenant break', type: 'date', half: true },
    { name: 'next_review', label: 'Next rent review', type: 'date', half: true },
    { name: 'area_sqft', label: 'Area (sq ft)', type: 'number', half: true },
    { name: 'service_charge', label: 'Service charge a year (£)', type: 'number', half: true },
    { name: 'sc_included', label: 'Service charge included in the rent', type: 'checkbox', help: 'PB Abbey pays it: change at renewal' },
    { name: 'notes', label: 'Notes', type: 'textarea' },
  ];

  const save = useMutation({
    mutationFn: (v) => {
      const data = Object.fromEntries(EDITABLE.map((k) => [k, v[k] === '' ? null : v[k] ?? null]));
      for (const k of NUM) if (data[k] != null) data[k] = Number(data[k]) || 0;
      const t = tenants.find((x) => x.id === data.tenant_id);
      const payload = { ...data, rent_amount: Number(data.rent_amount) || 0, rent_frequency: data.rent_frequency || 'monthly', vat_applicable: !!data.vat_applicable,
        sc_included: !!data.sc_included, tenant_name: t ? t.name : '', status: t ? 'occupied' : 'vacant' };
      return v.id ? base44.entities.Unit.update(v.id, { ...payload, updated_date: new Date().toISOString() }) : base44.entities.Unit.create(payload);
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['units'] }); setDialog(null); },
  });
  const del = useMutation({
    mutationFn: (id) => base44.entities.Unit.delete(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['units'] }),
    onError: (e) => alert(`Could not delete: ${e.message}`),
  });

  const monthly = rows.reduce((s, u) => s + (Number(u.rent_amount) || 0), 0);
  const let_ = rows.filter((u) => u.tenant_id).length;
  const actions = <Button className="gap-2 bg-neutral-900 hover:bg-neutral-800" onClick={() => { save.reset(); setDialog('new'); }}><Plus className="w-4 h-4" /> New unit</Button>;
  const open = (u) => { save.reset(); setDialog({ ...u, tenant_id: u.tenant_id || '', vat_applicable: u.vat_applicable !== false }); };
  // /tenant/units?unit=<id> (from Actions) opens that unit
  useEffect(() => {
    const id = params.get('unit'); const u = id && units.find((x) => x.id === id);
    if (u) { open(u); setParams({}, { replace: true }); }
  }, [params, units]); // eslint-disable-line react-hooks/exhaustive-deps
  const chipBtn = (k, label) => <button key={k || 'all'} onClick={() => setSite(k)} className={`h-8 px-3 text-[12px] border ${site === k ? 'bg-neutral-900 text-white border-neutral-900' : 'bg-white border-neutral-300 text-neutral-600'}`}>{label}</button>;

  return (
    <TenantShell title="Units" subtitle={`${rows.length} units · ${let_} let · ${gbp0(monthly * 12)} a year excl. VAT`} actions={actions}>
      <div className="mb-6">
        <TileGrid>
          <Tile label="Let" value={`${rows.filter((u) => u.tenant_id).length}/${rows.filter((u) => !/yard/i.test(u.reference || '')).length}`} sub="units" tone={rows.some((u) => !u.tenant_id && !/yard/i.test(u.reference || '')) ? 'amber' : 'green'}>
            <Ring value={rows.filter((u) => u.tenant_id).length} total={rows.filter((u) => !/yard/i.test(u.reference || '')).length} tone={rows.some((u) => !u.tenant_id && !/yard/i.test(u.reference || '')) ? 'amber' : 'green'} />
          </Tile>
          <Tile label="Rent a year" value={gbpK(monthly * 12)} sub="excl. VAT">
            <Ranked rows={Object.entries(rows.reduce((m, u) => { if (u.tenant_id) m[u.site || '—'] = (m[u.site || '—'] || 0) + (Number(u.rent_amount) || 0) * 12; return m; }, {})).sort((x, y) => y[1] - x[1]).map(([label, value]) => ({ label: label.split(',')[0], value }))} />
          </Tile>
          <Tile label="Below market" value={gbpK(rows.reduce((s2, u) => s2 + (u.tenant_id ? Math.max(0, (Number(u.market_rent) || 0) - (Number(u.rent_amount) || 0) * 12) : 0), 0))} sub="a year, let units" tone="amber">
            <Ranked rows={rows.filter((u) => u.tenant_id && Number(u.market_rent) - (Number(u.rent_amount) || 0) * 12 > 50).map((u) => ({ label: u.reference, value: Number(u.market_rent) - (Number(u.rent_amount) || 0) * 12 })).sort((x, y) => y.value - x.value).slice(0, 4)} color={TONE.amber} />
          </Tile>
          <Tile label="Lease dates ≤ 12 months" value={leaseEvents(rows, { months: 12 }).length} sub="incl. expired" tone={leaseEvents(rows, { months: 12 }).some((e) => e.tone === 'red') ? 'red' : 'amber'}>
            <Meter value={leaseEvents(rows, { months: 12 }).length} max={Math.max(rows.filter((u) => u.tenant_id).length, 1)} tone="amber" left="units affected" right={`of ${rows.filter((u) => u.tenant_id).length} let`} />
          </Tile>
        </TileGrid>
      </div>
      {sites.length > 1 && <div className="mb-3 flex flex-wrap gap-2">{chipBtn('', 'All properties')}{sites.map((s) => chipBtn(s, s))}</div>}
      <ResponsiveList
        rows={rows}
        onRowClick={open}
        empty="No units yet."
        columns={[
          { label: 'Unit', cell: (u) => u.reference, mobile: 'title' },
          { label: 'Property', cell: (u) => u.site || u.address, mobile: 'sub' },
          { label: 'Tenant', cell: (u) => u.tenant_name || <span className="text-neutral-400">vacant</span>, mobile: 'sub' },
          { label: 'Rent / year', right: true, cell: (u) => <>{Number(u.rent_amount) ? gbp0(u.rent_amount * 12) : u.tenant_id ? <span className="text-amber-700">not set</span> : '—'}
            {Number(u.market_rent) > (Number(u.rent_amount) || 0) * 12 + 1 && u.tenant_id && <span className="block text-[11px] text-amber-700">market {gbp0(u.market_rent)}</span>}
            {!u.tenant_id && Number(u.market_rent) > 0 && <span className="block text-[11px] text-neutral-400">asking {gbp0(u.market_rent)}</span>}</>, mobile: 'meta' },
          { label: 'Lease ends', cell: (u) => (u.lease_end ? fmtDate(u.lease_end) : '—'), mobile: 'hide' },
          { label: 'Next date', cell: (u) => { const e = nextEvent[u.id]; return e ? <span className="whitespace-nowrap">{chip(EVENT_CHIP[e.tone], e.kind === 'lease_end' && e.days < 0 ? 'holding over' : e.label.toLowerCase())}<span className="ml-1.5 text-[11px] text-neutral-400">{whenText(e.days)}</span></span> : chip(...(STATUS[u.tenant_id ? 'occupied' : 'vacant'])); }, mobile: 'sub' },
        ]}
        actions={(u, m) => <>
          <Act icon={Pencil} label="Edit" mobile={m} onClick={() => open(u)} />
          <Act icon={Trash2} label="Delete" tone="red" mobile={m} onClick={() => { if (confirm(`Delete unit "${u.reference}"? Its rent history stays.`)) del.mutate(u.id); }} />
        </>}
        footer={<tr><td className="px-4 py-3 text-[11px] uppercase tracking-[0.1em] font-medium text-neutral-500" colSpan={3}>Total a year (excl. VAT)</td><td className="px-4 py-3 text-right tabular-nums font-fig font-semibold">{gbp0(monthly * 12)}</td><td colSpan={3} /></tr>}
      />
      {units.some((u) => u.tenant_id && !Number(u.rent_amount)) && <p className="mt-2 text-[12px] text-amber-700">Units with no rent set are skipped when rent is generated.</p>}

      <EntityDialog
        open={dialog !== null}
        onClose={() => setDialog(null)}
        title={dialog === 'new' ? 'New unit' : `Edit ${dialog?.reference || 'unit'}`}
        fields={fields}
        initial={dialog === 'new' ? { rent_frequency: 'monthly', vat_applicable: true, tenant_id: '', site } : dialog}
        onSubmit={(v) => save.mutate(v)}
        submitting={save.isPending}
        error={save.error}
      />
    </TenantShell>
  );
}

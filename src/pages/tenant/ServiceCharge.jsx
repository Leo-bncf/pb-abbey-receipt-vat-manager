/* Tenant · Service charge — for multi-let buildings (Southernhay): the year's
 * budget split by each unit's share, who actually pays it (tenant, or PB Abbey
 * when the unit is empty or the charge is included in the rent), and the costs
 * spent so far. Costs found in the accountant's VAT report come in as
 * "suggested" and only count once confirmed. Nothing is sent. */
import React, { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Check, X, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { base44, supabase } from '@/api/base44Client';
import TenantShell from './TenantShell';
import { Tile, TileGrid, Meter, Split, Ranked, TONE, gbpK } from './viz';
import { EntityDialog, fmtDate } from './ui';

const gbp0 = (n) => `£${Math.round(Number(n) || 0).toLocaleString('en-GB')}`;
const CATS = ['Management', 'Cleaning', 'Utilities', 'Heating', 'Fire safety', 'Security', 'Compliance', 'Insurance', 'Repairs', 'Major works', 'Materials', 'Other'];
const PAYER = {
  tenant: ['text-emerald-700 border-emerald-200 bg-emerald-50', 'tenant'],
  empty: ['text-red-700 border-red-200 bg-red-50', 'PB Abbey · empty'],
  included: ['text-amber-700 border-amber-200 bg-amber-50', 'PB Abbey · in rent'],
};

export default function ServiceCharge() {
  const qc = useQueryClient();
  const [year, setYear] = useState(2026);
  const [tab, setTab] = useState('suggested');
  const [adding, setAdding] = useState(false);
  const { data: units = [] } = useQuery({ queryKey: ['units'], queryFn: () => base44.entities.Unit.list('reference') });
  const budgetsQ = useQuery({ queryKey: ['sc_budgets'], queryFn: async () => { const { data, error } = await supabase.from('sc_budgets').select('*'); if (error) throw error; return data; } });
  const costsQ = useQuery({ queryKey: ['sc_costs'], queryFn: async () => { const { data, error } = await supabase.from('sc_costs').select('*').order('cost_date', { ascending: false }); if (error) throw error; return data; } });

  const sites = useMemo(() => [...new Set(units.filter((u) => Number(u.sc_share) > 0).map((u) => u.site))], [units]);
  const site = sites[0] || 'Southernhay West, Exeter';
  const budget = Number((budgetsQ.data || []).find((b) => b.site === site && b.year === year)?.budget) || 0;
  const years = [...new Set((budgetsQ.data || []).filter((b) => b.site === site).map((b) => b.year))].sort();

  const rows = useMemo(() => units.filter((u) => u.site === site && Number(u.sc_share) > 0)
    .sort((a, b) => (a.reference || '').localeCompare(b.reference || '', 'en', { numeric: true }))
    .map((u) => {
      const sc = budget * Number(u.sc_share) / 100;
      const payer = !u.tenant_id ? 'empty' : u.sc_included ? 'included' : 'tenant';
      return { u, sc, payer };
    }), [units, site, budget]);
  const byTenants = rows.filter((r) => r.payer === 'tenant').reduce((s, r) => s + r.sc, 0);
  const byPba = budget - byTenants;

  const costs = (costsQ.data || []).filter((c) => c.site === site && String(c.cost_date || '').startsWith(String(year)));
  const sum = (st) => costs.filter((c) => c.status === st).reduce((s, c) => s + (Number(c.net) || 0), 0);
  const confirmed = sum('confirmed');
  const shown = costs.filter((c) => (tab === 'excluded' ? c.status === 'excluded' : c.status === tab));
  const byCat = Object.entries(costs.filter((c) => c.status === 'confirmed').reduce((m, c) => { m[c.category || 'Other'] = (m[c.category || 'Other'] || 0) + Number(c.net || 0); return m; }, {})).sort((a, b) => b[1] - a[1]);

  const upd = useMutation({
    mutationFn: async ({ c, patch }) => { const { error } = await supabase.from('sc_costs').update(patch).eq('id', c.id); if (error) throw error; },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sc_costs'] }),
  });
  const add = useMutation({
    mutationFn: async (v) => {
      const { error } = await supabase.from('sc_costs').insert({ site, cost_date: v.cost_date, supplier: v.supplier, description: v.description || null, net: Number(v.net) || 0, vat: Number(v.vat) || 0, category: v.category || 'Other', status: 'confirmed', source: 'Added by hand' });
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['sc_costs'] }); setAdding(false); },
  });

  const tabBtn = (k, label) => <button key={k} onClick={() => setTab(k)} className={`h-8 px-3 text-[12px] border ${tab === k ? 'bg-neutral-900 text-white border-neutral-900' : 'bg-white border-neutral-300 text-neutral-600'}`}>{label} <span className="font-fig opacity-70">{costs.filter((c) => c.status === k).length}</span></button>;

  return (
    <TenantShell title="Service charge" subtitle={`${site} · year ${year}. Nothing is sent from here.`}
      actions={<div className="flex gap-2">
        <select value={year} onChange={(e) => setYear(Number(e.target.value))} className="h-9 px-2 border border-neutral-300 bg-white text-[13px]" id="sc-year">{(years.length ? years : [2026]).map((y) => <option key={y} value={y}>{y}</option>)}</select>
        <Button className="gap-2 bg-neutral-900 hover:bg-neutral-800" onClick={() => { add.reset(); setAdding(true); }}><Plus className="w-4 h-4" /> Add a cost</Button>
      </div>}>
      <div className="mb-6">
        <TileGrid>
          <Tile label="Budget" value={gbpK(budget)} sub={`${year}, whole building`}>
            <Meter value={confirmed} max={budget || 1} tone={confirmed > budget ? 'red' : undefined} left={`spent ${gbpK(confirmed)}`} right={`${Math.round((confirmed / (budget || 1)) * 100)}%`} />
          </Tile>
          <Tile label="Recovered from tenants" value={`${Math.round((byTenants / (budget || 1)) * 100)}%`} sub={gbpK(byTenants)} tone={byTenants / (budget || 1) < 0.9 ? 'red' : 'green'}>
            <Split parts={[{ label: 'Tenants', value: byTenants, color: TONE.soft }, { label: 'Empty units', value: rows.filter((r) => r.payer === 'empty').reduce((s2, r) => s2 + r.sc, 0), color: TONE.red }, { label: 'In the rent', value: rows.filter((r) => r.payer === 'included').reduce((s2, r) => s2 + r.sc, 0), color: TONE.amber }]} />
          </Tile>
          <Tile label="Paid by PB Abbey" value={gbpK(byPba)} sub="a year" tone={byPba > 0 ? 'red' : 'green'} action={byPba > 0 ? 'Let empties, end “included”' : 'None'}>
            <Ranked rows={rows.filter((r) => r.payer !== 'tenant').sort((x, y) => y.sc - x.sc).slice(0, 4).map((r) => ({ label: r.u.reference, value: r.sc, color: r.payer === 'empty' ? TONE.red : TONE.amber }))} />
          </Tile>
          <Tile label="Costs by kind" value={gbpK(confirmed + sum('suggested'))} sub={`${gbpK(sum('suggested'))} to check`} tone={sum('suggested') > 0 ? 'amber' : undefined}>
            <Ranked rows={Object.entries(costs.filter((c) => c.status !== 'excluded').reduce((m, c) => { m[c.category || 'Other'] = (m[c.category || 'Other'] || 0) + Number(c.net || 0); return m; }, {})).sort((x, y) => y[1] - x[1]).slice(0, 4).map(([label, value]) => ({ label, value }))} />
          </Tile>
        </TileGrid>
      </div>

      <h2 className="text-[11px] uppercase tracking-[0.1em] font-medium text-neutral-400 mb-2">Who pays what</h2>
      <div className="bg-white border rule overflow-x-auto mb-8">
        <table className="w-full text-sm">
          <thead className="bg-neutral-50 border-b rule"><tr>{['Unit', 'Tenant', 'Share', 'A year', 'A quarter', 'Paid by'].map((h, i) => <th key={h} className={`px-4 py-2.5 text-[11px] uppercase tracking-[0.1em] font-medium text-neutral-400 ${i >= 2 && i <= 4 ? 'text-right' : 'text-left'}`}>{h}</th>)}</tr></thead>
          <tbody className="divide-y divide-neutral-200">
            {rows.map(({ u, sc, payer }) => (
              <tr key={u.id}>
                <td className="px-4 py-2.5 font-medium text-neutral-800">{u.reference}</td>
                <td className="px-4 py-2.5 text-neutral-600">{u.tenant_name || <span className="text-neutral-400">empty</span>}</td>
                <td className="px-4 py-2.5 text-right font-fig tabular-nums">{Number(u.sc_share).toFixed(2)}%</td>
                <td className="px-4 py-2.5 text-right font-fig tabular-nums">{gbp0(sc)}</td>
                <td className="px-4 py-2.5 text-right font-fig tabular-nums text-neutral-500">{gbp0(sc / 4)}</td>
                <td className="px-4 py-2.5"><span className={`inline-block px-2 py-0.5 rounded text-xs border whitespace-nowrap ${PAYER[payer][0]}`}>{PAYER[payer][1]}</span></td>
              </tr>
            ))}
          </tbody>
          <tfoot className="border-t-2 border-neutral-300 bg-neutral-50">
            <tr><td className="px-4 py-2.5 text-[11px] uppercase tracking-[0.1em] font-medium text-neutral-500" colSpan={2}>Total</td>
              <td className="px-4 py-2.5 text-right font-fig">{rows.reduce((s, r) => s + Number(r.u.sc_share), 0).toFixed(2)}%</td>
              <td className="px-4 py-2.5 text-right font-fig font-semibold">{gbp0(budget)}</td><td className="px-4 py-2.5 text-right font-fig text-neutral-500">{gbp0(budget / 4)}</td>
              <td className="px-4 py-2.5 text-[12px] text-red-700 font-fig">{gbp0(byPba)} by PB Abbey</td></tr>
          </tfoot>
        </table>
      </div>

      <div className="flex flex-wrap items-baseline justify-between gap-2 mb-2">
        <h2 className="text-[11px] uppercase tracking-[0.1em] font-medium text-neutral-400">Costs {year}</h2>
        {byCat.length > 0 && <p className="text-[12px] text-neutral-500 font-fig">{byCat.map(([k, v]) => `${k} ${gbp0(v)}`).join(' · ')}</p>}
      </div>
      <div className="mb-3 flex flex-wrap gap-2">{tabBtn('suggested', 'To check')}{tabBtn('confirmed', 'Confirmed')}{tabBtn('excluded', 'Not service charge')}</div>
      {tab === 'suggested' && shown.length > 0 && <p className="mb-2 text-[12px] text-neutral-500">Found in the accountant's VAT report. Confirm the ones that belong to this building's service charge.</p>}
      <ul className="bg-white border rule divide-y divide-neutral-200">
        {shown.map((c) => (
          <li key={c.id} className="px-4 py-2.5 flex flex-col md:flex-row md:items-center gap-2 md:gap-4">
            <div className="min-w-0 flex-1">
              <p className="text-[14px] text-neutral-900"><span className="font-medium">{c.supplier}</span>{c.description ? <span className="text-neutral-600"> · {c.description}</span> : ''}</p>
              <p className="text-[12px] text-neutral-500">{fmtDate(c.cost_date)}{c.note ? <span className="text-amber-700"> · {c.note}</span> : ''}</p>
            </div>
            <select value={c.category || 'Other'} onChange={(e) => upd.mutate({ c, patch: { category: e.target.value } })} className="h-8 px-2 border border-neutral-300 bg-white text-[12px] shrink-0" aria-label="Category">
              {CATS.map((k) => <option key={k} value={k}>{k}</option>)}
            </select>
            <span className="font-fig tabular-nums text-[14px] w-24 md:text-right shrink-0">{gbp0(c.net)}</span>
            <div className="flex gap-1.5 shrink-0">
              {c.status !== 'confirmed' && <button onClick={() => upd.mutate({ c, patch: { status: 'confirmed' } })} className="h-8 px-2.5 inline-flex items-center gap-1 text-[12px] bg-neutral-900 text-white"><Check className="w-3.5 h-3.5" /> Service charge</button>}
              {c.status !== 'excluded' && <button onClick={() => upd.mutate({ c, patch: { status: 'excluded' } })} className="h-8 px-2.5 inline-flex items-center gap-1 text-[12px] border border-neutral-300 text-neutral-600"><X className="w-3.5 h-3.5" /> Not</button>}
              {c.status !== 'suggested' && <button onClick={() => upd.mutate({ c, patch: { status: 'suggested' } })} className="h-8 px-2 inline-flex items-center text-[12px] border border-neutral-300 text-neutral-500" title="Back to check"><RotateCcw className="w-3.5 h-3.5" /></button>}
            </div>
          </li>
        ))}
        {shown.length === 0 && <li className="px-4 py-8 text-center text-[13px] text-neutral-400">Nothing here.</li>}
      </ul>
      {confirmed > 0 && budget > 0 && <p className="mt-3 text-[12px] text-neutral-500">Spent {gbp0(confirmed)} of a {gbp0(budget)} budget ({Math.round((confirmed / budget) * 100)}%). At year end, each tenant's share of the actual cost is compared with what they paid on account.</p>}

      <EntityDialog open={adding} onClose={() => setAdding(false)} title="Add a service charge cost" submitLabel="Add"
        fields={[
          { name: 'supplier', label: 'Supplier', required: true },
          { name: 'description', label: 'What for' },
          { name: 'cost_date', label: 'Date', type: 'date', required: true, half: true },
          { name: 'category', label: 'Category', type: 'select', half: true, options: CATS.map((k) => ({ value: k, label: k })) },
          { name: 'net', label: 'Amount excl. VAT (£)', type: 'number', required: true, half: true },
          { name: 'vat', label: 'VAT (£)', type: 'number', half: true },
        ]}
        initial={{ category: 'Repairs', cost_date: new Date().toISOString().slice(0, 10) }}
        onSubmit={(v) => add.mutate(v)} submitting={add.isPending} error={add.error} />
    </TenantShell>
  );
}

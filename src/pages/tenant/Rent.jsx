/* Tenant · Rent — one line per rent invoice (unit × period). Record payments
 * with their real date and amount (part payments allowed), edit any line, add
 * one by picking the unit, and generate the rent for a month or a range of
 * months (e.g. to catch up past months that were already paid). */
import React, { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Check, Trash2, Pencil, CalendarPlus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { base44, supabase } from '@/api/base44Client';
import TenantShell from './TenantShell';
import { EntityDialog, ResponsiveList, Act, chip, gbp, fmtDate, rentStatus, RENT_CHIP, isQuarterly } from './ui';
import { Tile, TileGrid, Ring, Ranked, MiniBars, TONE, gbpK } from './viz';

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const today = () => new Date().toISOString().slice(0, 10);
const monthStart = (m) => `${m}-01`;
const lastDay = (start, months) => { const d = new Date(`${start}T12:00:00`); d.setMonth(d.getMonth() + months); d.setDate(0); return d.toISOString().slice(0, 10); };
const monthsBetween = (a, b) => { const out = []; const d = new Date(`${a}-01T12:00:00`); const end = new Date(`${b}-01T12:00:00`); while (d <= end && out.length < 60) { out.push(d.toISOString().slice(0, 7)); d.setMonth(d.getMonth() + 1); } return out; };
const statusFor = (total, paid) => (paid >= total - 0.005 && total > 0 ? 'paid' : paid > 0 ? 'part_paid' : 'pending');

export default function Rent() {
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const { data: payments = [] } = useQuery({ queryKey: ['rent_payments'], queryFn: () => base44.entities.RentPayment.list('-due_date', 5000) });
  const { data: units = [] } = useQuery({ queryKey: ['units'], queryFn: () => base44.entities.Unit.list('reference') });
  const { data: tenants = [] } = useQuery({ queryKey: ['tenants'], queryFn: () => base44.entities.Tenant.list('name') });
  const [filter, setFilter] = useState('all');
  const tenantFilter = params.get('tenant') || '';
  const [pay, setPay] = useState(null);     // line being paid
  const [edit, setEdit] = useState(null);   // 'new' | line
  const [gen, setGen] = useState(false);
  // Automatic rent on the 1st (scan-runner, daily): app_settings 'rent_auto'.enabled
  const auto = useQuery({ queryKey: ['app_settings', 'rent_auto'], queryFn: () => base44.entities.AppSetting.get('rent_auto').catch(() => null) });
  const autoOn = !!auto.data?.value?.enabled;
  const toggleAuto = async () => {
    if (!autoOn && !confirm('Create the rent lines automatically on the 1st of every month?\n\nEach let unit gets its line (at the rent set on the unit). Unpaid lines show as overdue 7 days after the due date, so record payments as they come in.')) return;
    const value = { enabled: !autoOn };
    try { await base44.entities.AppSetting.update('rent_auto', { value, updated_date: new Date().toISOString() }); }
    catch { await base44.entities.AppSetting.create({ id: 'rent_auto', value }); }
    qc.invalidateQueries({ queryKey: ['app_settings', 'rent_auto'] });
  };
  const refresh = () => qc.invalidateQueries({ queryKey: ['rent_payments'] });
  const unitById = useMemo(() => Object.fromEntries(units.map((u) => [u.id, u])), [units]);

  // ---- record a payment
  const recordPay = useMutation({
    mutationFn: ({ p, amount, date }) => {
      const total = r2(p.total_amount), paid = r2((Number(p.amount_paid) || 0) + (Number(amount) || 0));
      if (!(Number(amount) > 0)) throw new Error('Enter the amount received.');
      return base44.entities.RentPayment.update(p.id, { amount_paid: paid, outstanding: r2(Math.max(0, total - paid)), payment_date: date || today(), status: statusFor(total, paid), updated_date: new Date().toISOString() });
    },
    onSuccess: () => { refresh(); setPay(null); },
  });

  // ---- add / edit a line
  const saveLine = useMutation({
    mutationFn: (v) => {
      const u = unitById[v.unit_id];
      if (!u && !v.id) throw new Error('Choose the unit.');
      const net = r2(v.net_amount), vat = r2(v.vat_amount), total = r2(net + vat);
      const paid = r2(v.id ? v.amount_paid : 0);
      const data = { unit_id: v.unit_id || null, tenant_id: u?.tenant_id || v.tenant_id || null, tenant_name: u?.tenant_name || v.tenant_name || '',
        period_start: v.period_start || null, period_end: v.period_end || null, due_date: v.due_date || v.period_start, net_amount: net, vat_amount: vat, total_amount: total,
        amount_paid: paid, outstanding: r2(Math.max(0, total - paid)), status: statusFor(total, paid), notes: v.notes || (u ? u.reference : null) };
      if (!data.due_date) throw new Error('A due date is needed.');
      return v.id ? base44.entities.RentPayment.update(v.id, { ...data, updated_date: new Date().toISOString() }) : base44.entities.RentPayment.create(data);
    },
    onSuccess: () => { refresh(); setEdit(null); },
  });
  // Picking a unit / period fills the rest.
  const fillLine = (v, changed) => {
    const u = unitById[v.unit_id];
    if (changed === 'unit_id' || changed === 'period_start') {
      const months = isQuarterly(u?.rent_frequency) ? 3 : 1;
      const net = u ? r2((Number(u.rent_amount) || 0) * months) : v.net_amount;
      return { net_amount: net, vat_amount: u && u.vat_applicable !== false ? r2(net * 0.2) : 0, period_end: v.period_start ? lastDay(v.period_start, months) : v.period_end, due_date: v.period_start || v.due_date };
    }
    if (changed === 'net_amount') return { vat_amount: !u || u.vat_applicable !== false ? r2(Number(v.net_amount) * 0.2) : 0 };
    return null;
  };

  const del = useMutation({ mutationFn: (id) => base44.entities.RentPayment.delete(id), onSuccess: refresh, onError: (e) => alert(`Could not delete: ${e.message}`) });

  // ---- generate a month or a range
  const generate = useMutation({
    mutationFn: async ({ from, to, alreadyPaid }) => {
      if (!from) throw new Error('Choose the first month.');
      const months = monthsBetween(from, to || from);
      const t0 = new Date(Date.now() - 5000).toISOString();
      let n = 0;
      for (const m of months) {
        const { data, error } = await supabase.rpc('generate_rent', { p_month: monthStart(m) });
        if (error) throw error;
        n += data || 0;
      }
      if (alreadyPaid && n) {
        const { data: fresh, error } = await supabase.from('rent_payments').select('id,total_amount,due_date').gte('created_date', t0).eq('status', 'pending');
        if (error) throw error;
        for (const p of fresh) await base44.entities.RentPayment.update(p.id, { status: 'paid', amount_paid: p.total_amount, outstanding: 0, payment_date: p.due_date });
      }
      return { n, months: months.length };
    },
    onSuccess: ({ n, months }) => { refresh(); setGen(false); alert(n ? `${n} rent line${n === 1 ? '' : 's'} created for ${months} month${months === 1 ? '' : 's'}.` : 'Nothing new: those months already exist (or no unit has rent set).'); },
  });

  // ---- list
  const rows = payments.filter((p) => {
    const s = rentStatus(p);
    if (filter === 'unpaid' && s === 'paid') return false;
    if (filter === 'paid' && s !== 'paid') return false;
    if (tenantFilter && p.tenant_id !== tenantFilter) return false;
    return true;
  });
  const owed = payments.filter((p) => rentStatus(p) !== 'paid').reduce((s, p) => s + (Number(p.outstanding) || 0), 0);
  const overdue = payments.filter((p) => rentStatus(p) === 'overdue').reduce((s, p) => s + (Number(p.outstanding) || 0), 0);
  const late = payments.filter((p) => rentStatus(p) === 'overdue').length;
  const tot = (k) => rows.reduce((s, p) => s + (Number(p[k]) || 0), 0);
  const thisMonth = today().slice(0, 7);
  const lastMonth = payments.reduce((m, p) => ((p.period_start || '') > m ? p.period_start : m), '').slice(0, 7);

  const actions = (
    <>
      <Button variant="outline" className="gap-2 border-neutral-300" onClick={() => { generate.reset(); setGen(true); }}><CalendarPlus className="w-4 h-4" /> Generate rent</Button>
      <Button className="gap-2 bg-neutral-900 hover:bg-neutral-800" onClick={() => { saveLine.reset(); setEdit('new'); }}><Plus className="w-4 h-4" /> Add line</Button>
    </>
  );
  const chipBtn = (k, label) => <button key={k} onClick={() => setFilter(k)} className={`h-8 px-3 text-[12px] border ${filter === k ? 'bg-neutral-900 text-white border-neutral-900' : 'bg-white border-neutral-300 text-neutral-600'}`}>{label}</button>;

  return (
    <TenantShell title="Rent" subtitle={`${owed > 0 ? `${overdue > 0 ? `${gbp(overdue)} overdue (${late} lines) · ` : ''}${gbp(owed - overdue)} not yet due` : 'Nothing owed'} · rent recorded up to ${lastMonth ? new Date(`${lastMonth}-01T12:00:00`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }) : '—'}`} actions={actions}>
      <div className="mb-6">
        <TileGrid>
          <Tile label="Collected" value={`${Math.round((payments.reduce((s2, p) => s2 + (Number(p.amount_paid) || 0), 0) / (payments.filter((p) => p.due_date <= today()).reduce((s2, p) => s2 + (Number(p.total_amount) || 0), 0) || 1)) * 100)}%`} sub="of rent due so far">
            <Ring value={payments.reduce((s2, p) => s2 + (Number(p.amount_paid) || 0), 0)} total={payments.filter((p) => p.due_date <= today()).reduce((s2, p) => s2 + (Number(p.total_amount) || 0), 0)} tone="green" />
          </Tile>
          <Tile label="Overdue" value={gbpK(overdue)} sub={`${late} lines`} tone={overdue > 0 ? 'red' : 'green'} action={overdue > 0 ? 'Check bank, then chase' : 'Nothing late'}>
            <Ranked rows={Object.entries(payments.filter((p) => rentStatus(p) === 'overdue').reduce((m, p) => { m[p.tenant_name] = (m[p.tenant_name] || 0) + Number(p.outstanding || 0); return m; }, {})).sort((x, y) => y[1] - x[1]).slice(0, 4).map(([label, value]) => ({ label: label.replace(/ (Ltd|Limited|LLP|UK Ltd|NHS Foundation Trust)$/i, ''), value }))} color={TONE.red} />
          </Tile>
          <Tile label="Not yet due" value={gbpK(owed - overdue)} sub="invoiced in advance" />
          <Tile label="Received by month" value={gbpK(payments.filter((p) => (p.payment_date || '').slice(0, 7) === today().slice(0, 7)).reduce((s2, p) => s2 + (Number(p.amount_paid) || 0), 0))} sub="this month">
            <MiniBars data={Array.from({ length: 6 }, (_, i) => { const d = new Date(); d.setMonth(d.getMonth() - 5 + i, 1); const m = d.toISOString().slice(0, 7); return { label: d.toLocaleDateString('en-GB', { month: 'short' }), value: Math.round(payments.filter((p) => (p.payment_date || '').slice(0, 7) === m).reduce((s2, p) => s2 + (Number(p.amount_paid) || 0), 0)) }; })} />
          </Tile>
        </TileGrid>
      </div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {chipBtn('all', 'All')}{chipBtn('unpaid', 'Not paid')}{chipBtn('paid', 'Paid')}
        <button onClick={toggleAuto} className="ml-auto text-[12px] underline text-neutral-500 hover:text-neutral-900">{autoOn ? 'Rent is created automatically on the 1st — switch off' : 'Create rent automatically each month'}</button>
        <select value={tenantFilter} onChange={(e) => { const v = e.target.value; setParams(v ? { tenant: v } : {}); }} className="h-8 px-2 border border-neutral-300 bg-white text-[12px]">
          <option value="">All tenants</option>{tenants.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
      </div>
      <ResponsiveList
        rows={rows}
        empty="No rent lines. Use “Generate rent”."
        columns={[
          { label: 'Tenant', cell: (p) => p.tenant_name || '—', mobile: 'title' },
          { label: 'Unit', cell: (p) => unitById[p.unit_id]?.reference || p.notes || '—', mobile: 'sub' },
          { label: 'Period', cell: (p) => (p.period_start ? `${fmtDate(p.period_start)} – ${fmtDate(p.period_end)}` : '—'), mobile: 'sub' },
          { label: 'Due', cell: (p) => fmtDate(p.due_date), mobile: 'hide' },
          { label: 'Total', right: true, cell: (p) => gbp(p.total_amount), mobile: 'meta' },
          { label: 'Owed', right: true, cell: (p) => (Number(p.outstanding) > 0 ? gbp(p.outstanding) : '—'), mobile: 'hide' },
          { label: 'Status', cell: (p) => <span className="whitespace-nowrap">{chip(...RENT_CHIP[rentStatus(p)])}{p.payment_date && rentStatus(p) !== 'pending' && <span className="ml-1.5 text-[11px] text-neutral-400">{fmtDate(p.payment_date)}</span>}</span>, mobile: 'meta' },
        ]}
        actions={(p, m) => <>
          {rentStatus(p) !== 'paid' && <Act icon={Check} label="Record payment" tone="green" mobile={m} onClick={() => { recordPay.reset(); setPay(p); }} />}
          <Act icon={Pencil} label="Edit" mobile={m} onClick={() => { saveLine.reset(); setEdit(p); }} />
          <Act icon={Trash2} label="Delete" tone="red" mobile={m} onClick={() => { if (confirm(`Delete this rent line (${p.tenant_name}, ${fmtDate(p.period_start || p.due_date)})?`)) del.mutate(p.id); }} />
        </>}
        footer={<tr><td className="px-4 py-3 text-[11px] uppercase tracking-[0.1em] font-medium text-neutral-500" colSpan={4}>Total shown</td><td className="px-4 py-3 text-right tabular-nums font-fig font-semibold">{gbp(tot('total_amount'))}</td><td className="px-4 py-3 text-right tabular-nums font-fig font-semibold">{gbp(tot('outstanding'))}</td><td colSpan={2} /></tr>}
      />

      {/* Record a payment */}
      <EntityDialog open={!!pay} onClose={() => setPay(null)} title={`Payment — ${pay?.tenant_name || ''}`} submitLabel="Record payment"
        intro={pay && `${unitById[pay.unit_id]?.reference || ''} ${pay.period_start ? `· ${fmtDate(pay.period_start)} – ${fmtDate(pay.period_end)}` : ''} · ${gbp(pay.outstanding)} still owed of ${gbp(pay.total_amount)}`}
        fields={[{ name: 'amount', label: 'Amount received (£)', type: 'number', required: true, half: true }, { name: 'date', label: 'Received on', type: 'date', required: true, half: true }]}
        initial={pay ? { amount: r2(pay.outstanding), date: today() } : null}
        onSubmit={(v) => recordPay.mutate({ p: pay, amount: v.amount, date: v.date })}
        submitting={recordPay.isPending} error={recordPay.error} />

      {/* Add / edit a line */}
      <EntityDialog open={!!edit} onClose={() => setEdit(null)} title={edit === 'new' ? 'Add a rent line' : 'Edit rent line'}
        fields={[
          { name: 'unit_id', label: 'Unit', type: 'select', required: true, options: units.map((u) => ({ value: u.id, label: `${u.reference} — ${u.tenant_name || 'vacant'}` })) },
          { name: 'period_start', label: 'Period from', type: 'date', half: true },
          { name: 'period_end', label: 'Period to', type: 'date', half: true },
          { name: 'due_date', label: 'Due on', type: 'date', required: true, half: true },
          { name: 'net_amount', label: 'Rent excl. VAT (£)', type: 'number', required: true, half: true },
          { name: 'vat_amount', label: 'VAT (£)', type: 'number', half: true, help: '20% filled in for you' },
          { name: 'notes', label: 'Note', half: true },
        ]}
        initial={edit === 'new' ? { period_start: monthStart(thisMonth), due_date: monthStart(thisMonth) } : edit}
        onChange={fillLine}
        onSubmit={(v) => saveLine.mutate(v)}
        submitting={saveLine.isPending} error={saveLine.error} />

      {/* Generate */}
      <EntityDialog open={gen} onClose={() => setGen(false)} title="Generate rent" submitLabel="Generate"
        intro="Creates one rent line per let unit for each month (quarterly units only in their quarter months: Jan / Apr / Jul / Oct, or Feb / May / Aug / Nov for Team House), at the rent set on the unit. Months that already exist are skipped."
        fields={[
          { name: 'from', label: 'From month', type: 'month', required: true, half: true },
          { name: 'to', label: 'To month', type: 'month', required: true, half: true },
          { name: 'alreadyPaid', label: 'These months are already paid', type: 'checkbox', help: 'For catching up past months: marks them paid on their due date.' },
        ]}
        initial={{ from: thisMonth, to: thisMonth, alreadyPaid: false }}
        onSubmit={(v) => generate.mutate(v)}
        submitting={generate.isPending} error={generate.error} />
    </TenantShell>
  );
}

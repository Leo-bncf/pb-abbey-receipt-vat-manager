/* Tenant · Report — one page per month for the monthly catch-up: rent billed and
 * received, what is owed, empty units, lease dates coming up, costs from the
 * scanned receipts, and what was done in Actions. Printable; nothing is sent. */
import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Printer } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { base44, supabase } from '@/api/base44Client';
import TenantShell from './TenantShell';
import { fmtDate, rentStatus, leaseEvents, whenText } from './ui';

const gbp0 = (n) => `£${Math.round(Number(n) || 0).toLocaleString('en-GB')}`;
const ym = (d) => String(d || '').slice(0, 7);
const monthLabel = (m) => new Date(`${m}-01T12:00:00`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
const PRINT_CSS = `@media print { @page { size: A4; margin: 12mm; } body * { visibility: hidden !important; } #pb-report, #pb-report * { visibility: visible !important; } #pb-report { position: absolute; left: 0; top: 0; width: 100%; } .no-print { display: none !important; } }`;

function Block({ title, children, right }) {
  return (
    <section className="break-inside-avoid">
      <div className="flex items-baseline justify-between gap-3 mb-2 border-b border-neutral-300 pb-1">
        <h2 className="text-[11px] uppercase tracking-[0.12em] font-medium text-neutral-500">{title}</h2>
        {right && <span className="text-[12px] text-neutral-500 font-fig">{right}</span>}
      </div>
      {children}
    </section>
  );
}
const Row = ({ k, v, tone }) => (
  <div className="flex justify-between gap-4 py-1.5 border-b border-neutral-100 text-[13px]">
    <span className="text-neutral-600 min-w-0">{k}</span>
    <span className={`font-fig shrink-0 ${tone === 'red' ? 'text-red-700' : tone === 'green' ? 'text-emerald-700' : 'text-neutral-900'}`}>{v}</span>
  </div>
);

export default function Report() {
  const thisMonth = new Date().toISOString().slice(0, 7);
  const [month, setMonth] = useState(thisMonth);
  const from = `${month}-01`;
  const to = (() => { const d = new Date(`${from}T12:00:00`); d.setMonth(d.getMonth() + 1, 0); return d.toISOString().slice(0, 10); })();

  const { data: units = [] } = useQuery({ queryKey: ['units'], queryFn: () => base44.entities.Unit.list('reference') });
  const { data: payments = [] } = useQuery({ queryKey: ['rent_payments'], queryFn: () => base44.entities.RentPayment.list('-due_date', 5000) });
  const { data: actions = [] } = useQuery({ queryKey: ['actions-all'], queryFn: () => base44.entities.Action.list('-updated_date', 2000) });
  const receiptsQ = useQuery({
    queryKey: ['report-receipts', month],
    queryFn: async () => {
      const { data, error } = await supabase.from('receipts').select('vendor_name,total_amount,vat_amount,currency,receipt_date')
        .eq('workspace', 'pbabbey').gte('receipt_date', from).lte('receipt_date', to).limit(5000);
      if (error) throw error; return data;
    },
  });

  const r = useMemo(() => {
    const billed = payments.filter((p) => ym(p.due_date) === month);
    const received = payments.filter((p) => ym(p.payment_date) === month && Number(p.amount_paid) > 0);
    const owed = payments.filter((p) => rentStatus(p) === 'overdue');
    const let_ = units.filter((u) => u.tenant_id);
    const empty = units.filter((u) => !u.tenant_id && !/yard/i.test(u.reference || ''));
    const rentYear = let_.reduce((s, u) => s + (Number(u.rent_amount) || 0) * 12, 0);
    const bySite = {};
    for (const u of units) { const k = u.site || '—'; bySite[k] = bySite[k] || { n: 0, let: 0, rent: 0 }; bySite[k].n++; if (u.tenant_id) { bySite[k].let++; bySite[k].rent += (Number(u.rent_amount) || 0) * 12; } }
    const done = actions.filter((a) => a.status === 'done' && ym(a.resolved_date) === month);
    const open = actions.filter((a) => a.status === 'open');
    return {
      billed, billedTotal: billed.reduce((s, p) => s + (Number(p.total_amount) || 0), 0),
      received, receivedTotal: received.reduce((s, p) => s + (Number(p.amount_paid) || 0), 0),
      owed, owedTotal: owed.reduce((s, p) => s + (Number(p.outstanding) || 0), 0),
      let_, empty, rentYear, bySite, done, open,
      doneGain: done.filter((a) => a.amount_kind === 'year' && !a.data?.at_risk).reduce((s, a) => s + (Number(a.amount) || 0), 0),
      events: leaseEvents(units, { months: 12 }),
    };
  }, [payments, units, actions, month]);

  const rc = receiptsQ.data || [];
  const gbpRc = rc.filter((x) => (x.currency || 'GBP') === 'GBP');
  const costTotal = gbpRc.reduce((s, x) => s + (Number(x.total_amount) || 0), 0);
  const costVat = gbpRc.reduce((s, x) => s + (Number(x.vat_amount) || 0), 0);
  const vendors = Object.entries(gbpRc.reduce((m, x) => { const k = x.vendor_name || 'Unknown'; m[k] = (m[k] || 0) + (Number(x.total_amount) || 0); return m; }, {})).sort((a, b) => b[1] - a[1]).slice(0, 6);
  const months = Array.from({ length: 18 }, (_, i) => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - i + 2); return d.toISOString().slice(0, 7); });

  return (
    <TenantShell title="Monthly report" subtitle="For the monthly catch-up. Print it or keep it on screen; nothing is sent."
      actions={<div className="flex gap-2 no-print">
        <select value={month} onChange={(e) => setMonth(e.target.value)} className="h-9 px-2 border border-neutral-300 bg-white text-[13px]" id="report-month">
          {months.map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}
        </select>
        <Button onClick={() => window.print()} className="gap-2 bg-neutral-900 hover:bg-neutral-800"><Printer className="w-4 h-4" /> Print</Button>
      </div>}>
      <style>{PRINT_CSS}</style>
      <div id="pb-report" className="bg-white border rule p-5 md:p-8 flex flex-col gap-7 max-w-4xl">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <p className="text-[11px] uppercase tracking-[0.14em] text-neutral-500">PB Abbey Ltd · properties</p>
            <h1 className="text-[24px] font-semibold tracking-tight">{monthLabel(month)}</h1>
          </div>
          <p className="text-[12px] text-neutral-500">Prepared {fmtDate(new Date().toISOString())}</p>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-px bg-neutral-200 border border-neutral-200">
          {[['Rent a year', gbp0(r.rentYear), `${r.let_.length} units let`], ['Billed this month', gbp0(r.billedTotal), `${r.billed.length} lines, incl. VAT`],
            ['Received this month', gbp0(r.receivedTotal), `${r.received.length} payments recorded`], ['Owed now', gbp0(r.owedTotal), `${r.owed.length} lines more than 7 days late`]].map(([k, v, s], i) => (
            <div key={k} className="bg-white p-3.5"><p className="text-[11px] uppercase tracking-[0.1em] text-neutral-500">{k}</p><p className={`mt-1 text-[20px] font-fig font-medium ${i === 3 && r.owedTotal > 0 ? 'text-red-700' : ''}`}>{v}</p><p className="text-[11px] text-neutral-400">{s}</p></div>
          ))}
        </div>

        <div className="grid md:grid-cols-2 gap-7">
          <Block title="Owed now" right={gbp0(r.owedTotal)}>
            {r.owed.length ? r.owed.slice(0, 12).map((p) => <Row key={p.id} k={`${p.tenant_name} · due ${fmtDate(p.due_date)}`} v={gbp0(p.outstanding)} tone="red" />) : <p className="text-[13px] text-neutral-500">Nothing late.</p>}
            {r.owed.some((p) => /not checked/i.test(p.notes || '')) && <p className="mt-2 text-[11px] text-neutral-500">Some of these may be paid already: payments after 30 Sept 2026 have not been checked against the bank yet.</p>}
          </Block>
          <Block title="Received this month" right={gbp0(r.receivedTotal)}>
            {r.received.length ? r.received.slice(0, 12).map((p) => <Row key={p.id} k={`${p.tenant_name} · ${fmtDate(p.payment_date)}`} v={gbp0(p.amount_paid)} tone="green" />) : <p className="text-[13px] text-neutral-500">No payment recorded this month.</p>}
          </Block>
        </div>

        <div className="grid md:grid-cols-2 gap-7">
          <Block title="Properties" right={`${r.let_.length} let · ${r.empty.length} empty`}>
            {Object.entries(r.bySite).sort().map(([k, s]) => <Row key={k} k={`${k} · ${s.let}/${s.n} let`} v={`${gbp0(s.rent)} a year`} />)}
            {r.empty.length > 0 && <p className="mt-2 text-[12px] text-amber-800">Empty: {r.empty.map((u) => u.reference).join(', ')}. About {gbp0(r.empty.reduce((s, u) => s + (Number(u.market_rent) || 0) + (Number(u.service_charge) || 0), 0))} a year lost in rent and service charge.</p>}
          </Block>
          <Block title="Costs from scanned receipts" right={gbp0(costTotal)}>
            {receiptsQ.isLoading ? <p className="text-[13px] text-neutral-400">Loading…</p> : gbpRc.length ? <>
              {vendors.map(([k, v]) => <Row key={k} k={k} v={gbp0(v)} />)}
              <p className="mt-2 text-[12px] text-neutral-500">{gbpRc.length} receipts in £, of which VAT {gbp0(costVat)}.{rc.length > gbpRc.length ? ` ${rc.length - gbpRc.length} receipts in other currencies not counted.` : ''}</p>
            </> : <p className="text-[13px] text-neutral-500">No receipts dated this month.</p>}
          </Block>
        </div>

        <Block title="Lease dates in the next 12 months" right={`${r.events.length}`}>
          {r.events.length ? r.events.map((e) => <Row key={e.id} k={`${fmtDate(e.date)} · ${e.unit.reference} · ${e.unit.tenant_name}`} v={`${e.label} (${whenText(e.days)})`} tone={e.tone === 'red' ? 'red' : undefined} />) : <p className="text-[13px] text-neutral-500">None.</p>}
        </Block>

        <div className="grid md:grid-cols-2 gap-7">
          <Block title="Done this month" right={r.doneGain ? `+${gbp0(r.doneGain)} a year` : ''}>
            {r.done.length ? r.done.map((a) => <Row key={a.id} k={a.title} v={a.amount ? gbp0(a.amount) : '✓'} tone="green" />) : <p className="text-[13px] text-neutral-500">Nothing marked done in Actions this month.</p>}
          </Block>
          <Block title="Still to do" right={`${r.open.length}`}>
            {r.open.sort((a, b) => ({ red: 0, amber: 1 }[a.severity] ?? 2) - ({ red: 0, amber: 1 }[b.severity] ?? 2) || (Number(b.amount) || 0) - (Number(a.amount) || 0)).slice(0, 8)
              .map((a) => <Row key={a.id} k={a.title} v={a.amount ? gbp0(a.amount) : ''} tone={a.severity === 'red' ? 'red' : undefined} />)}
            {r.open.length > 8 && <p className="mt-2 text-[12px] text-neutral-500 no-print">and {r.open.length - 8} more in <Link to="/tenant/actions" className="underline">Actions</Link>.</p>}
          </Block>
        </div>
      </div>
    </TenantShell>
  );
}

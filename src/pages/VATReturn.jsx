/* Hallmark · genre: modern-minimal · theme: ledger-swiss
 * UK VAT return (HMRC 9 boxes) computed from rent (output VAT) and receipts
 * (input VAT). Quarter pattern + scheme are selectable because they depend on
 * PB Abbey's HMRC registration. Not an MTD submission — export for the
 * accountant / bridging software, or record the figures per quarter. */
import React, { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Download, Save, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { base44 } from '@/api/base44Client';
import AppShell, { StatStrip } from '@/components/AppShell';
import { newWorkbook, tableSheet, download } from '@/lib/excel';

const STAGGERS = {
  1: { label: 'Mar / Jun / Sep / Dec', ends: [3, 6, 9, 12] },
  2: { label: 'Apr / Jul / Oct / Jan', ends: [4, 7, 10, 1] },
  3: { label: 'May / Aug / Nov / Feb', ends: [5, 8, 11, 2] },
};
const gbp = (n) => `£${(Number(n) || 0).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const pounds = (n) => `£${Math.trunc(Number(n) || 0).toLocaleString('en-GB')}`; // boxes 6–9: whole pounds
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const fmt = (s) => (s ? new Date(s).toLocaleDateString('en-GB') : '—');
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

// Quarters (3-month periods) ending on the stagger's months, most recent first.
function quartersFor(stagger) {
  const ends = STAGGERS[stagger].ends;
  const out = [];
  const now = new Date();
  for (let y = now.getFullYear() + 1; y >= now.getFullYear() - 2; y--) {
    for (const m of [...ends].sort((a, b) => b - a)) {
      const end = new Date(y, m, 0); // last day of month m
      const start = new Date(end.getFullYear(), end.getMonth() - 2, 1);
      if (start > now) continue; // future quarter
      const deadline = new Date(end.getFullYear(), end.getMonth() + 2, 7); // 1 month + 7 days
      out.push({ key: iso(end), start: iso(start), end: iso(end), deadline: iso(deadline),
        label: `${start.toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })} – ${end.toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })}` });
    }
  }
  return out.sort((a, b) => (a.end < b.end ? 1 : -1)).slice(0, 10);
}

const lsGet = (k, d) => { try { return localStorage.getItem(k) || d; } catch { return d; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } };

export default function VATReturn() {
  const qc = useQueryClient();
  const [stagger, setStaggerRaw] = useState(() => Number(lsGet('vat.stagger', '1')));
  const [scheme, setScheme] = useState(() => lsGet('vat.scheme', 'standard'));
  // The quarter pattern is shared by everyone (and the agenda / Outlook reminders).
  const vatSettings = useQuery({ queryKey: ['app_settings', 'vat_settings'], queryFn: () => base44.entities.AppSetting.get('vat_settings').catch(() => null) });
  React.useEffect(() => { const v = vatSettings.data?.value?.stagger; if (v && v !== stagger) { setStaggerRaw(v); lsSet('vat.stagger', String(v)); } }, [vatSettings.data]);
  const setStagger = async (v) => {
    setStaggerRaw(v);
    const value = { ...(vatSettings.data?.value || {}), stagger: v };
    try { await base44.entities.AppSetting.update('vat_settings', { value, updated_date: new Date().toISOString() }); }
    catch { await base44.entities.AppSetting.create({ id: 'vat_settings', value }); }
    qc.invalidateQueries({ queryKey: ['app_settings', 'vat_settings'] });
  };
  const quarters = useMemo(() => quartersFor(stagger), [stagger]);
  const [qKey, setQKey] = useState(null);
  const q = quarters.find((x) => x.key === qKey) || quarters.find((x) => x.end < iso(new Date())) || quarters[0];

  const { data: receipts = [] } = useQuery({ queryKey: ['receipts', 'all'], queryFn: () => base44.entities.Receipt.list('-receipt_date', 5000) });
  const { data: rent = [] } = useQuery({ queryKey: ['rent_payments'], queryFn: () => base44.entities.RentPayment.list('-due_date') });
  const { data: saved = [] } = useQuery({ queryKey: ['vat_quarters'], queryFn: () => base44.entities.VATQuarter.list('-end_date') });

  const inQ = (d) => d && d >= q.start && d <= q.end;

  const calc = useMemo(() => {
    // Output VAT (Box 1/6) from rent. Standard = tax point is the due date.
    // Cash accounting = only what was actually received, when it was received.
    const rentLines = [];
    rent.forEach((p) => {
      if (scheme === 'cash') {
        if (!inQ(p.payment_date) || !(p.amount_paid > 0)) return;
        const share = p.total_amount ? Math.min(1, p.amount_paid / p.total_amount) : 1;
        rentLines.push({ ...p, net: r2(p.net_amount * share), vat: r2(p.vat_amount * share), date: p.payment_date });
      } else if (inQ(p.due_date)) {
        rentLines.push({ ...p, net: r2(p.net_amount), vat: r2(p.vat_amount), date: p.due_date });
      }
    });
    // Input VAT (Box 4/7) from GBP receipts dated in the quarter. EUR receipts
    // carry foreign VAT that can't be reclaimed on a UK return → excluded + flagged.
    const rq = receipts.filter((r) => inQ(r.receipt_date));
    const gbpR = rq.filter((r) => (r.currency || 'GBP') === 'GBP');
    const eurR = rq.filter((r) => r.currency && r.currency !== 'GBP');
    const box1 = r2(rentLines.reduce((s, l) => s + l.vat, 0));
    const box4 = r2(gbpR.reduce((s, r) => s + (Number(r.vat_amount) || 0), 0));
    const box6 = rentLines.reduce((s, l) => s + l.net, 0);
    const box7 = gbpR.reduce((s, r) => s + ((Number(r.total_amount) || 0) - (Number(r.vat_amount) || 0)), 0);
    const boxes = { 1: box1, 2: 0, 3: box1, 4: box4, 5: r2(box1 - box4), 6: box6, 7: box7, 8: 0, 9: 0 };
    return {
      boxes, rentLines, gbpR, eurR,
      review: gbpR.filter((r) => r.needs_review && !r.is_reviewed).length,
      eurTotal: eurR.reduce((s, r) => s + (Number(r.total_amount) || 0), 0),
    };
  }, [receipts, rent, q, scheme]);

  const savedRow = saved.find((s) => s.quarter_id === q.key);

  const save = useMutation({
    mutationFn: async (status) => {
      const b = calc.boxes;
      const payload = { quarter_id: q.key, start_date: q.start, end_date: q.end, submission_deadline: q.deadline, payment_deadline: q.deadline,
        vat_charged: b[1], vat_received: b[1], vat_reclaimable: b[4], vat_owed_to_hmrc: b[5], status,
        notes: `Scheme: ${scheme}; quarters: ${STAGGERS[stagger].label}; Box6 £${Math.trunc(b[6])}; Box7 £${Math.trunc(b[7])}` };
      return savedRow ? base44.entities.VATQuarter.update(savedRow.id, payload) : base44.entities.VATQuarter.create(payload);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['vat_quarters'] }),
  });

  const exportXlsx = async () => {
    const b = calc.boxes;
    const wb = await newWorkbook();
    const sub = [`Quarter ${fmt(q.start)} – ${fmt(q.end)} · deadline ${fmt(q.deadline)} · scheme: ${scheme}`, `Prepared ${new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })} from the PB Abbey app — check before submitting through MTD software.`];
    tableSheet(wb, {
      sheet: 'VAT return', title: 'PB ABBEY LTD — VAT return', subtitle: sub, totals: false,
      columns: [{ header: 'Box', type: 'int', width: 6 }, { header: 'Description', width: 52 }, { header: 'Amount £', type: 'money', width: 16 }],
      rows: [[1, 'VAT due on sales and other outputs', b[1]], [2, 'VAT due on acquisitions from EU (Northern Ireland only)', 0], [3, 'Total VAT due (box 1 + box 2)', b[3]],
        [4, 'VAT reclaimed on purchases and other inputs', b[4]], [5, 'Net VAT to pay to HMRC or reclaim (box 3 − box 4)', b[5]],
        [6, 'Total value of sales excluding VAT (whole pounds)', Math.trunc(b[6])], [7, 'Total value of purchases excluding VAT (whole pounds)', Math.trunc(b[7])],
        [8, 'Supplies of goods to EU (Northern Ireland only)', 0], [9, 'Acquisitions of goods from EU (Northern Ireland only)', 0]],
      notes: warnings.map((w) => ({ warn: true, text: w })),
    });
    tableSheet(wb, {
      sheet: 'Rent (outputs)', title: 'Rent — VAT charged', subtitle: sub,
      columns: [{ header: 'Date', type: 'date', width: 11 }, { header: 'Tenant', width: 34 }, { header: 'Net £', type: 'money', width: 13, total: 'sum' }, { header: 'VAT £', type: 'money', width: 12, total: 'sum' }, { header: 'Status', width: 10 }],
      rows: calc.rentLines.map((l) => [l.date, l.tenant_name, l.net, l.vat, l.status]),
    });
    tableSheet(wb, {
      sheet: 'Receipts (inputs)', title: 'Receipts — VAT reclaimed', subtitle: [...sub.slice(0, 1), 'UK (GBP) receipts only; foreign VAT cannot be reclaimed here.'],
      columns: [{ header: 'Date', type: 'date', width: 11 }, { header: 'Supplier', width: 32 }, { header: 'Total £', type: 'money', width: 13, total: 'sum' }, { header: 'VAT £', type: 'money', width: 12, total: 'sum' }, { header: 'Net £', type: 'money', width: 13, total: 'sum' }, { header: 'Checked', width: 12 }, { header: 'Original', type: 'link', width: 42 }],
      rows: calc.gbpR.map((r) => [r.receipt_date, r.vendor_name, r2(r.total_amount), r2(r.vat_amount), r2((Number(r.total_amount) || 0) - (Number(r.vat_amount) || 0)), r.needs_review && !r.is_reviewed ? 'NOT CHECKED' : 'yes', { text: (r.file_name || '').replace(/\s*\[\d+\/\d+\]\s*$/, '') || 'Open', url: r.file_url }]),
    });
    await download(wb, `PB-Abbey-VAT-${q.start}_${q.end}.xlsx`);
  };

  const exportCsv = () => {
    const b = calc.boxes;
    const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const rows = [
      ['PB Abbey Ltd — VAT return', `${q.start} to ${q.end}`], ['Scheme', scheme], [],
      ['Box', 'Description', 'Amount'],
      [1, 'VAT due on sales and other outputs', b[1].toFixed(2)], [2, 'VAT due on acquisitions from EU (NI only)', '0.00'],
      [3, 'Total VAT due (1 + 2)', b[3].toFixed(2)], [4, 'VAT reclaimed on purchases and other inputs', b[4].toFixed(2)],
      [5, 'Net VAT to pay to HMRC or reclaim (3 − 4)', b[5].toFixed(2)], [6, 'Total value of sales excluding VAT', Math.trunc(b[6])],
      [7, 'Total value of purchases excluding VAT', Math.trunc(b[7])], [8, 'Supplies of goods to EU (NI only)', 0], [9, 'Acquisitions of goods from EU (NI only)', 0],
      [], ['RENT (outputs)'], ['Date', 'Tenant', 'Net', 'VAT', 'Status'],
      ...calc.rentLines.map((l) => [l.date, l.tenant_name, l.net.toFixed(2), l.vat.toFixed(2), l.status]),
      [], ['RECEIPTS (inputs, GBP)'], ['Date', 'Vendor', 'Total', 'VAT', 'Document'],
      ...calc.gbpR.map((r) => [r.receipt_date, r.vendor_name, (Number(r.total_amount) || 0).toFixed(2), (Number(r.vat_amount) || 0).toFixed(2), r.file_name]),
    ];
    const blob = new Blob([rows.map((r) => r.map(esc).join(',')).join('\n')], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = `PB-Abbey-VAT-${q.start}_${q.end}.csv`; a.click();
    URL.revokeObjectURL(a.href);
  };

  const b = calc.boxes;
  const BOXES = [
    [1, 'VAT due on sales and other outputs', gbp(b[1])],
    [2, 'VAT due on acquisitions from the EU (NI only)', gbp(0)],
    [3, 'Total VAT due', gbp(b[3])],
    [4, 'VAT reclaimed on purchases and other inputs', gbp(b[4])],
    [5, b[5] >= 0 ? 'Net VAT to pay to HMRC' : 'Net VAT to reclaim from HMRC', gbp(Math.abs(b[5]))],
    [6, 'Total value of sales, excluding VAT', pounds(b[6])],
    [7, 'Total value of purchases, excluding VAT', pounds(b[7])],
    [8, 'Supplies of goods to the EU (NI only)', pounds(0)],
    [9, 'Acquisitions of goods from the EU (NI only)', pounds(0)],
  ];

  const warnings = [];
  if (calc.rentLines.length === 0) warnings.push('No rent is recorded for this quarter, so Box 1 and Box 6 are probably understated. Generate or add the rent for these months in Tenant → Rent first.');
  if (calc.review > 0) warnings.push(`${calc.review} receipt(s) in this quarter are still flagged "needs review" — check them before relying on Box 4.`);
  if (calc.eurR.length > 0) warnings.push(`${calc.eurR.length} EUR receipt(s) (€${calc.eurTotal.toFixed(2)}) excluded: foreign VAT can't be reclaimed on a UK return. Ask the accountant whether their net cost belongs in Box 7.`);

  const actions = (
    <>
      <Button variant="outline" className="gap-2 border-neutral-300" onClick={exportXlsx}><Download className="w-4 h-4" /> Excel</Button>
      <Button variant="outline" className="gap-2 border-neutral-300" onClick={exportCsv}>CSV</Button>
      <Button className="gap-2 bg-neutral-900 hover:bg-neutral-800" disabled={save.isPending} onClick={() => save.mutate(savedRow?.status === 'submitted' ? 'submitted' : 'draft')}>
        <Save className="w-4 h-4" /> {savedRow ? 'Update saved figures' : 'Save quarter'}
      </Button>
      {savedRow?.status === 'submitted' ? (
        <span className="inline-flex items-center gap-1.5 text-[13px] text-emerald-700 px-2">✓ Filed with HMRC</span>
      ) : (
        <Button variant="outline" className="border-neutral-300" disabled={save.isPending}
          onClick={() => { if (confirm('Mark this quarter as filed with HMRC? It will disappear from the To do list.')) save.mutate('submitted'); }}>
          Mark as filed
        </Button>
      )}
    </>
  );

  const sel = 'h-9 rounded border border-neutral-300 bg-white px-2 text-[13px]';
  return (
    <AppShell title="VAT return" subtitle={`HMRC 9-box summary · ${q.start.split('-').reverse().join('/')} – ${q.end.split('-').reverse().join('/')}`} actions={actions}>
      <div className="flex flex-wrap items-end gap-4 mb-6">
        <label className="text-[11px] uppercase tracking-[0.1em] text-neutral-500">Quarter
          <select className={`${sel} block mt-1 normal-case tracking-normal`} value={q.key} onChange={(e) => setQKey(e.target.value)}>
            {quarters.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}
          </select>
        </label>
        <label className="text-[11px] uppercase tracking-[0.1em] text-neutral-500">VAT quarters end
          <select className={`${sel} block mt-1 normal-case tracking-normal`} value={stagger} onChange={(e) => { const v = Number(e.target.value); setStagger(v); lsSet('vat.stagger', String(v)); setQKey(null); }}>
            {Object.entries(STAGGERS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
        </label>
        <label className="text-[11px] uppercase tracking-[0.1em] text-neutral-500">Scheme
          <select className={`${sel} block mt-1 normal-case tracking-normal`} value={scheme} onChange={(e) => { setScheme(e.target.value); lsSet('vat.scheme', e.target.value); }}>
            <option value="standard">Standard (invoice basis)</option>
            <option value="cash">Cash accounting</option>
          </select>
        </label>
        <div className="text-[12px] text-neutral-500 pb-2 font-fig">
          Filing deadline {fmt(q.deadline)}{savedRow ? ` · saved as ${savedRow.status}` : ''}
        </div>
      </div>

      <div className="mb-6">
        <StatStrip items={[
          { label: 'VAT on rent (Box 1)', value: gbp(b[1]), sub: `${calc.rentLines.length} rent line(s)` },
          { label: 'VAT reclaimable (Box 4)', value: gbp(b[4]), sub: `${calc.gbpR.length} receipt(s)` },
          { label: b[5] >= 0 ? 'To pay HMRC (Box 5)' : 'To reclaim (Box 5)', value: gbp(Math.abs(b[5])), accent: b[5] > 0 },
        ]} />
      </div>

      {warnings.length > 0 && (
        <div className="mb-6 border border-amber-200 bg-amber-50 px-4 py-3 space-y-1.5">
          {warnings.map((w, i) => (
            <p key={i} className="text-[13px] text-amber-900 flex gap-2"><AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />{w}</p>
          ))}
        </div>
      )}

      <div className="bg-white border rule">
        {BOXES.map(([n, label, val]) => (
          <div key={n} className={`flex items-center justify-between px-5 py-3 border-b rule last:border-b-0 ${n === 5 ? 'bg-neutral-50' : ''}`}>
            <div className="flex items-center gap-4">
              <span className="w-12 text-[11px] uppercase tracking-[0.1em] text-neutral-400 font-fig">Box {n}</span>
              <span className={`text-[13px] ${n === 5 ? 'font-semibold text-neutral-900' : 'text-neutral-700'}`}>{label}</span>
            </div>
            <span className={`font-fig tabular-nums ${n === 5 ? 'text-[16px] font-semibold' : 'text-[14px]'} ${n === 5 && b[5] > 0 ? 'text-red-700' : 'text-neutral-900'}`}>{val}</span>
          </div>
        ))}
      </div>

      <p className="mt-4 text-[12px] text-neutral-500 max-w-3xl leading-relaxed">
        Prepared from PB Abbey's records, not submitted to HMRC. Making Tax Digital requires filing through HMRC-recognised
        software: send the CSV to the accountant (or bridging software) to file. Boxes 6–9 are whole pounds, as HMRC requires.
      </p>
    </AppShell>
  );
}

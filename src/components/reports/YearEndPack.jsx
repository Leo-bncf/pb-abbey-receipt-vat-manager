/* Year-end pack: one styled Excel file for the accountant covering a financial
 * year (1 July – 30 June). Sheets: Summary (with checks before sending), Receipts
 * (link to each original), By month (costs and rent side by side), By supplier,
 * Rent, Rent by unit, VAT by quarter (computed here, next to what was saved/filed).
 * Euros are converted to pounds at the ECB rate of the receipt date; foreign VAT
 * can't be reclaimed on a UK return, so it is counted as cost. */
import React, { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Download, Loader2 } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { COMPANY, financialYears, VAT_STAGGERS, iso } from '@/lib/company';
import { newWorkbook, tableSheet, summarySheet, download } from '@/lib/excel';

const n2 = (v) => Math.round((Number(v) || 0) * 100) / 100;
const day = (r) => (r.receipt_date || r.created_date || '').slice(0, 10);
const monthName = (m) => new Date(`${m}-01T12:00:00`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
const longDate = (s) => new Date(`${s}T12:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
const docName = (f) => (f || '').replace(/\s*\[\d+\/\d+\]\s*$/, '');

// ECB EUR->GBP reference rates (Frankfurter), the rate at or before each date.
async function eurToGbp(from, to) {
  const res = await fetch(`https://api.frankfurter.dev/v1/${from}..${to}?base=EUR&symbols=GBP`);
  if (!res.ok) throw new Error(`exchange rates unavailable (${res.status})`);
  const rates = Object.entries((await res.json()).rates || {}).map(([d, v]) => [d, v.GBP]).sort((a, b) => (a[0] < b[0] ? -1 : 1));
  if (!rates.length) throw new Error('no exchange rates returned');
  return (d) => { let r = rates[0][1]; for (const [k, v] of rates) { if (k <= d) r = v; else break; } return r; };
}

// Months of the year up to today (or the year end).
function monthsOf(fy) {
  const out = []; const d = new Date(`${fy.start}T12:00:00`);
  const stop = new Date(Math.min(new Date(`${fy.end}T12:00:00`), new Date()));
  while (d <= stop) { out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`); d.setMonth(d.getMonth() + 1); }
  return out;
}

// VAT quarters (by the shared quarter pattern) that end inside the year.
function quartersOf(fy, stagger) {
  const ends = VAT_STAGGERS[stagger] || VAT_STAGGERS[1];
  const out = [];
  for (let y = Number(fy.start.slice(0, 4)); y <= Number(fy.end.slice(0, 4)) + 1; y++) {
    for (const m of ends) {
      const end = iso(new Date(y, m, 0, 12)), start = iso(new Date(y, m - 3, 1, 12));
      if (end >= fy.start && end <= fy.end) out.push({ key: end, start, end });
    }
  }
  return out.sort((a, b) => (a.end < b.end ? -1 : 1));
}

export default function YearEndPack() {
  const years = financialYears(4);
  // The year just closed is the one the accountant needs (the current one is still running).
  const [key, setKey] = useState(years[1].key);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const ref = useRef(null);
  useEffect(() => { if (window.location.hash === '#year-end') ref.current?.scrollIntoView({ block: 'start' }); }, []);

  const { data: receipts = [] } = useQuery({ queryKey: ['receipts', 'all'], queryFn: () => base44.entities.Receipt.list('-receipt_date', 5000) });
  const fy = years.find((y) => y.key === key);
  const inYear = receipts.filter((r) => day(r) >= fy.start && day(r) <= fy.end);
  const unchecked = inYear.filter((r) => r.needs_review && !r.is_reviewed).length;
  const have = new Set(inYear.map((r) => day(r).slice(0, 7)));
  const emptyMonths = monthsOf(fy).filter((m) => !have.has(m)).map((m) => new Date(`${m}-01T12:00:00`).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' }));

  const build = async () => {
    setBusy(true); setErr(null);
    try {
      const [folders, rent, units, vatq, vatSet] = await Promise.all([
        base44.entities.Folder.list('name'),
        base44.entities.RentPayment.list('due_date'),
        base44.entities.Unit.list('reference'),
        base44.entities.VATQuarter.list('end_date'),
        base44.entities.AppSetting.get('vat_settings').catch(() => null),
      ]);
      const folderName = Object.fromEntries(folders.map((f) => [f.id, f.name]));
      const unitRef = Object.fromEntries(units.map((u) => [u.id, u.reference || u.address || 'Unit']));
      const rows = [...inYear].sort((a, b) => (day(a) < day(b) ? -1 : 1));
      const eur = rows.filter((r) => r.currency === 'EUR');
      const rate = eur.length ? await eurToGbp(day(eur[0]), day(eur[eur.length - 1])) : null;

      // ---- receipts, in pounds
      const lines = rows.map((r) => {
        const fx = r.currency === 'EUR' ? rate(day(r)) : 1;
        const total = n2((r.total_amount || 0) * fx);
        const vat = r.currency === 'GBP' || !r.currency ? n2(r.vat_amount || 0) : 0;
        return { r, fx, total, vat, net: n2(total - vat), month: day(r).slice(0, 7), supplier: (r.vendor_name || '(no name)').trim() };
      });
      const sum = (arr, k) => n2(arr.reduce((t, x) => t + (Number(x[k]) || 0), 0));
      const foreign = lines.filter((x) => x.r.currency && x.r.currency !== 'GBP');

      // ---- rent invoices due in the year
      const rentRows = rent.filter((p) => p.due_date && p.due_date >= fy.start && p.due_date <= fy.end);
      const rs = (arr, k) => n2(arr.reduce((t, p) => t + (Number(p[k]) || 0), 0));
      const rentMonths = new Set(rentRows.map((p) => p.due_date.slice(0, 7)));
      const months = monthsOf(fy);
      const noRentMonths = months.filter((m) => !rentMonths.has(m));

      // ---- VAT by quarter (computed) vs saved
      const stagger = vatSet?.value?.stagger || 1;
      const quarters = quartersOf(fy, stagger).map((q) => {
        const out = rs(rent.filter((p) => p.due_date && p.due_date >= q.start && p.due_date <= q.end), 'vat_amount');
        const inp = sum(lines.filter((x) => day(x.r) >= q.start && day(x.r) <= q.end), 'vat');
        const saved = vatq.find((v) => v.quarter_id === q.key);
        return { ...q, out, inp, net: n2(out - inp), saved };
      });
      const missingQ = quarters.filter((q) => q.end < iso(new Date()) && q.saved?.status !== 'submitted');
      const short = (m) => new Date(`${m}-01T12:00:00`).toLocaleDateString('en-GB', { month: 'short' });

      const wb = await newWorkbook();
      const period = `Financial year ${fy.label} (${longDate(fy.start)} – ${longDate(fy.end)})`;
      const prepared = `Prepared ${longDate(iso(new Date()))} from the PB Abbey app`;

      // ---- Summary
      const checks = [
        unchecked ? { warn: true, text: `${unchecked} receipt${unchecked === 1 ? ' is' : 's are'} not checked yet — marked "NOT CHECKED" in the Receipts sheet.` } : { text: 'Every receipt has been checked.' },
        emptyMonths.length ? { warn: true, text: `No receipts at all for ${emptyMonths.join(', ')} — statements not uploaded yet?` } : { text: 'Receipts for every month of the year.' },
        noRentMonths.length ? { warn: true, text: `No rent invoice in the app for ${noRentMonths.length} of ${months.length} months (${noRentMonths.map(short).join(', ')}) — rent not entered in the Tenant app?` } : { text: 'Rent invoices for every month.' },
        missingQ.length ? { warn: true, text: `${missingQ.length} VAT quarter${missingQ.length === 1 ? '' : 's'} not marked as filed in the app (quarters to ${missingQ.map((q) => longDate(q.end)).join('; ')}).` } : { text: 'All VAT quarters of the year are marked as filed.' },
        ...(foreign.length ? [{ text: `${foreign.length} receipts in euros converted at ECB rates; French VAT on them is counted as cost (not reclaimable on a UK return).` }] : []),
      ];
      const eurTotal = n2(foreign.reduce((t, x) => t + (x.r.total_amount || 0), 0));
      summarySheet(wb, {
        title: `${COMPANY.name} — year-end pack`,
        subtitle: [`Company no. ${COMPANY.number} · ${period}`, prepared],
        blocks: [
          { heading: 'Overview', rows: [
            ['Rent invoiced (excl. VAT)', rs(rentRows, 'net_amount')],
            ['Costs from receipts (excl. reclaimable VAT)', sum(lines, 'net')],
            ['Rent less receipt costs', n2(rs(rentRows, 'net_amount') - sum(lines, 'net')), 'money', 'Not a profit figure: loan interest, bank charges, insurance etc. are not in the app.', true],
          ] },
          { heading: 'Costs (receipts)', rows: [
            ['Receipts', lines.length, 'int'],
            ['Total paid', sum(lines, 'total')],
            ['UK VAT reclaimable', sum(lines, 'vat')],
            ['Net cost', sum(lines, 'net'), 'money', '', true],
            ...(foreign.length ? [['of which paid in euros', sum(foreign, 'total'), 'money', `${foreign.length} receipts, €${eurTotal.toLocaleString('en-GB', { minimumFractionDigits: 2 })} at ECB rates`]] : []),
          ] },
          { heading: 'Rent', rows: [
            ['Invoices due in the year', rentRows.length, 'int'],
            ['Invoiced (incl. VAT)', rs(rentRows, 'total_amount')],
            ['of which VAT', rs(rentRows, 'vat_amount')],
            ['Received', rs(rentRows, 'amount_paid')],
            ['Outstanding', rs(rentRows, 'outstanding'), 'money', '', true],
          ] },
          { heading: 'VAT (computed from the app)', rows: [
            ['VAT charged on rent', sum(quarters, 'out')],
            ['VAT reclaimable on receipts', sum(quarters, 'inp')],
            ['Net VAT for the year', sum(quarters, 'net'), 'money', 'Positive = owed to HMRC. See "VAT by quarter".', true],
          ] },
        ],
        checks,
      });

      // ---- Receipts
      tableSheet(wb, {
        sheet: 'Receipts', title: 'Receipts', subtitle: [period, 'Amounts in pounds; euro receipts converted at the ECB rate of the receipt date. "Original" opens the scanned document.'],
        columns: [
          { header: 'Date', type: 'date', width: 11 }, { header: 'Supplier', width: 30 }, { header: 'Country', width: 14 }, { header: 'Currency', width: 9 },
          { header: 'Total (original)', type: 'number', width: 14 }, { header: 'ECB rate', type: 'rate', width: 9 },
          { header: 'Total £', type: 'money', width: 12, total: 'sum' }, { header: 'VAT £', type: 'money', width: 11, total: 'sum' }, { header: 'Net £', type: 'money', width: 12, total: 'sum' },
          { header: 'VAT %', width: 7 }, { header: 'Checked', width: 13 }, { header: 'Folder', width: 20 }, { header: 'Original', type: 'link', width: 42 }, { header: 'Notes', width: 50 },
        ],
        rows: lines.map(({ r, fx, total, vat, net }) => [day(r), r.vendor_name || '', r.country || '', r.currency || 'GBP', n2(r.total_amount), r.currency === 'EUR' ? Number(fx.toFixed(5)) : '',
          total, vat, net, r.vat_rate ? `${Math.round(r.vat_rate)}%` : '', r.needs_review && !r.is_reviewed ? 'NOT CHECKED' : 'yes', folderName[r.folder_id] || '',
          { text: docName(r.file_name) || 'Open', url: r.file_url }, (r.extraction_notes || '').replace(/\s*\[[^\]]*\]/g, '').slice(0, 250)]),
      });

      // ---- By month (costs and rent side by side)
      tableSheet(wb, {
        sheet: 'By month', title: 'By month', subtitle: [period, 'Costs from receipts next to rent invoiced (by due date).'],
        columns: [{ header: 'Month', width: 18 }, { header: 'Receipts', type: 'int', width: 10, total: 'sum' }, { header: 'Costs total £', type: 'money', width: 14, total: 'sum' },
          { header: 'VAT reclaimable £', type: 'money', width: 16, total: 'sum' }, { header: 'Costs net £', type: 'money', width: 14, total: 'sum' },
          { header: 'Rent invoiced net £', type: 'money', width: 17, total: 'sum' }, { header: 'Rent VAT £', type: 'money', width: 12, total: 'sum' }],
        rows: months.map((m) => {
          const L = lines.filter((x) => x.month === m); const R = rentRows.filter((p) => p.due_date.slice(0, 7) === m);
          return [monthName(m), L.length, sum(L, 'total'), sum(L, 'vat'), sum(L, 'net'), rs(R, 'net_amount'), rs(R, 'vat_amount')];
        }),
        notes: emptyMonths.length ? [{ warn: true, text: `No receipts: ${emptyMonths.join(', ')}.` }] : [],
      });

      // ---- By supplier
      const bySup = {};
      lines.forEach((x) => { const k = x.supplier.toLowerCase(); const s = (bySup[k] ||= { name: x.supplier, n: 0, total: 0, vat: 0, net: 0, first: day(x.r), last: day(x.r) }); s.n++; s.total += x.total; s.vat += x.vat; s.net += x.net; if (day(x.r) > s.last) s.last = day(x.r); });
      tableSheet(wb, {
        sheet: 'By supplier', title: 'By supplier', subtitle: [period, 'Largest first.'],
        columns: [{ header: 'Supplier', width: 34 }, { header: 'Receipts', type: 'int', width: 10, total: 'sum' }, { header: 'Total £', type: 'money', width: 13, total: 'sum' },
          { header: 'VAT £', type: 'money', width: 12, total: 'sum' }, { header: 'Net £', type: 'money', width: 13, total: 'sum' }, { header: 'First', type: 'date', width: 11 }, { header: 'Last', type: 'date', width: 11 }],
        rows: Object.values(bySup).sort((a, b) => b.total - a.total).map((s) => [s.name, s.n, n2(s.total), n2(s.vat), n2(s.net), s.first, s.last]),
      });

      // ---- Rent
      tableSheet(wb, {
        sheet: 'Rent', title: 'Rent invoices', subtitle: [period, 'Invoices with a due date in the year (Tenant app).'],
        columns: [{ header: 'Due date', type: 'date', width: 11 }, { header: 'Tenant', width: 30 }, { header: 'Unit', width: 16 }, { header: 'Period from', type: 'date', width: 11 }, { header: 'Period to', type: 'date', width: 11 },
          { header: 'Net £', type: 'money', width: 12, total: 'sum' }, { header: 'VAT £', type: 'money', width: 11, total: 'sum' }, { header: 'Total £', type: 'money', width: 12, total: 'sum' },
          { header: 'Paid £', type: 'money', width: 12, total: 'sum' }, { header: 'Paid on', type: 'date', width: 11 }, { header: 'Outstanding £', type: 'money', width: 13, total: 'sum' }, { header: 'Status', width: 10 }],
        rows: rentRows.map((p) => [p.due_date, p.tenant_name || '', unitRef[p.unit_id] || '', p.period_start || '', p.period_end || '', n2(p.net_amount), n2(p.vat_amount), n2(p.total_amount), n2(p.amount_paid), p.payment_date || '', n2(p.outstanding), p.status || '']),
        notes: noRentMonths.length ? [{ warn: true, text: `No rent invoice for ${noRentMonths.map(monthName).join(', ')}.` }] : [],
      });

      // ---- Rent by unit
      const byUnit = {};
      rentRows.forEach((p) => { const k = p.unit_id || p.tenant_name; const u = (byUnit[k] ||= { unit: unitRef[p.unit_id] || '—', tenants: new Set(), n: 0, net: 0, vat: 0, total: 0, paid: 0, out: 0 }); u.tenants.add(p.tenant_name); u.n++; u.net += +p.net_amount || 0; u.vat += +p.vat_amount || 0; u.total += +p.total_amount || 0; u.paid += +p.amount_paid || 0; u.out += +p.outstanding || 0; });
      tableSheet(wb, {
        sheet: 'Rent by unit', title: 'Rent by unit', subtitle: [period],
        columns: [{ header: 'Unit', width: 18 }, { header: 'Tenant', width: 34 }, { header: 'Invoices', type: 'int', width: 10, total: 'sum' }, { header: 'Net £', type: 'money', width: 12, total: 'sum' },
          { header: 'VAT £', type: 'money', width: 11, total: 'sum' }, { header: 'Total £', type: 'money', width: 12, total: 'sum' }, { header: 'Received £', type: 'money', width: 12, total: 'sum' }, { header: 'Outstanding £', type: 'money', width: 13, total: 'sum' }],
        rows: Object.values(byUnit).sort((a, b) => (a.unit < b.unit ? -1 : 1)).map((u) => [u.unit, [...u.tenants].join(', '), u.n, n2(u.net), n2(u.vat), n2(u.total), n2(u.paid), n2(u.out)]),
      });

      // ---- VAT by quarter
      tableSheet(wb, {
        sheet: 'VAT by quarter', title: 'VAT by quarter', subtitle: [period, 'Computed from rent (VAT charged, by due date) and receipts (UK VAT reclaimable), next to what was saved on the VAT return page.'],
        columns: [{ header: 'Quarter from', type: 'date', width: 12 }, { header: 'Quarter to', type: 'date', width: 12 }, { header: 'VAT on rent £', type: 'money', width: 14, total: 'sum' },
          { header: 'VAT on receipts £', type: 'money', width: 16, total: 'sum' }, { header: 'Net £', type: 'money', width: 12, total: 'sum' },
          { header: 'Saved: owed to HMRC £', type: 'money', width: 20, total: 'sum' }, { header: 'Status', width: 16 }],
        rows: quarters.map((q) => [q.start, q.end, q.out, q.inp, q.net, q.saved ? n2(q.saved.vat_owed_to_hmrc) : '', q.saved ? (q.saved.status === 'submitted' ? 'filed' : 'saved, not filed') : (q.end < iso(new Date()) ? 'not saved' : 'in progress')]),
        notes: ['Net: positive = owed to HMRC, negative = to reclaim.', ...(missingQ.length ? [{ warn: true, text: `${missingQ.length} ended quarter(s) not marked as filed in the app.` }] : [])],
      });

      await download(wb, `PB Abbey year-end pack ${fy.key}.xlsx`);
    } catch (e) {
      console.error(e);
      setErr(e.message || String(e));
    } finally { setBusy(false); }
  };

  return (
    <div ref={ref} id="year-end" className="bg-white border rule p-5 mb-8 scroll-mt-6">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-neutral-900">Year-end pack for the accountant</p>
          <p className="text-xs text-neutral-500 mt-0.5">One Excel file for the financial year (1 July – 30 June): summary and checks, receipts with a link to each original, by month, by supplier, rent, rent by unit, VAT by quarter.</p>
        </div>
        <div className="flex gap-2 shrink-0">
          <select value={key} onChange={(e) => setKey(e.target.value)} className="h-9 px-2 border border-neutral-300 bg-white text-[13px]">
            {years.map((y) => <option key={y.key} value={y.key}>{y.label}{y.current ? ' (in progress)' : ''}</option>)}
          </select>
          <button onClick={build} disabled={busy || inYear.length === 0} className="inline-flex items-center gap-2 h-9 px-4 bg-neutral-900 text-white text-[13px] disabled:opacity-40">
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />} Download
          </button>
        </div>
      </div>
      <p className="mt-3 text-[12px] text-neutral-500 font-fig">
        {inYear.length} receipt{inYear.length === 1 ? '' : 's'} in this year
        {unchecked > 0 && <span className="text-amber-700"> · {unchecked} not checked yet — check them first so the figures are final</span>}
        {emptyMonths.length > 0 && <span className="block text-amber-700 mt-1">No receipts at all for {emptyMonths.join(', ')} — upload those statements before sending the pack.</span>}
      </p>
      {err && <p className="mt-2 text-[12px] text-red-600">{err}</p>}
    </div>
  );
}

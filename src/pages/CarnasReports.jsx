/* Carnas · Reports — every payment made for the house in France (being sold):
 * not a tax view, just what was paid, to whom and when. One list in date order
 * (no folders), totals by year / month / supplier, and a styled Excel export.
 * Amounts are in euros as printed; other currencies are listed apart. */
import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Download, Loader2 } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import AppShell, { StatStrip } from '@/components/AppShell';
import { newWorkbook, tableSheet, summarySheet, download } from '@/lib/excel';
import { wsPath } from '@/lib/workspace';

const eur = (n) => `${(Number(n) || 0).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const day = (r) => (r.receipt_date || r.created_date || '').slice(0, 10);
const docName = (f) => (f || '').replace(/\s*\[\d+\/\d+\]\s*$/, '');
const longDate = (d) => (d ? new Date(`${d}T12:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
const monthLabel = (m) => new Date(`${m}-01T12:00:00`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });

export default function CarnasReports() {
  const { data: receipts = [], isLoading } = useQuery({ queryKey: ['receipts', 'all'], queryFn: () => base44.entities.Receipt.list('-receipt_date', 5000) });
  const years = useMemo(() => [...new Set(receipts.map((r) => day(r).slice(0, 4)).filter(Boolean))].sort().reverse(), [receipts]);
  const [scope, setScope] = useState('all'); // 'all' | 'y:2026'
  const [busy, setBusy] = useState(false);

  const inScope = receipts.filter((r) => scope === 'all' || day(r).startsWith(scope.slice(2)));
  const other = inScope.filter((r) => (r.currency || 'EUR') !== 'EUR');
  const unchecked = inScope.filter((r) => r.needs_review && !r.is_reviewed).length;
  const pays = inScope.filter((r) => (r.currency || 'EUR') === 'EUR').map((r) => ({ r, amt: r2(r.total_amount) }))
    .sort((a, b) => day(a.r).localeCompare(day(b.r)) || (a.r.vendor_name || '').localeCompare(b.r.vendor_name || ''));
  const total = r2(pays.reduce((t, x) => t + x.amt, 0));
  const group = (key) => Object.entries(pays.reduce((m, x) => { const k = key(x); (m[k] ||= []).push(x); return m; }, {}))
    .map(([k, L]) => ({ k, n: L.length, amt: r2(L.reduce((t, x) => t + x.amt, 0)), last: day(L[L.length - 1].r) }));
  const byMonth = group((x) => day(x.r).slice(0, 7)).sort((a, b) => a.k.localeCompare(b.k));
  const byYear = group((x) => day(x.r).slice(0, 4)).sort((a, b) => a.k.localeCompare(b.k));
  const bySupplier = group((x) => (x.r.vendor_name || 'Unknown').trim()).sort((a, b) => b.amt - a.amt);
  const first = pays[0] && day(pays[0].r), last = pays.length && day(pays[pays.length - 1].r);
  const scopeLabel = scope === 'all' ? 'All years' : `Year ${scope.slice(2)}`;

  const exportXlsx = async () => {
    setBusy(true);
    try {
      const wb = await newWorkbook();
      const sub = [`${scopeLabel} · ${pays.length} payment${pays.length === 1 ? '' : 's'} in euros, ${longDate(first)} – ${longDate(last)}`, `Prepared ${new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })} from the PB Abbey app (Carnas)`];
      summarySheet(wb, {
        title: 'Carnas — payments for the house',
        subtitle: sub,
        blocks: [
          { heading: 'Total', rows: [['Payments', pays.length, 'int'], ['Total paid', total, 'eur', '', true]] },
          ...(byYear.length > 1 ? [{ heading: 'By year', rows: byYear.map((x) => [`${x.k} — ${x.n} payment${x.n === 1 ? '' : 's'}`, x.amt, 'eur']) }] : []),
          { heading: 'Biggest suppliers', rows: bySupplier.slice(0, 10).map((x) => [`${x.k} — ${x.n} payment${x.n === 1 ? '' : 's'}`, x.amt, 'eur']) },
        ],
        checks: [
          unchecked ? { warn: true, text: `${unchecked} payment${unchecked === 1 ? ' is' : 's are'} not checked yet.` } : { text: 'Every payment has been checked.' },
          ...(other.length ? [{ warn: true, text: `${other.length} payment${other.length === 1 ? '' : 's'} in another currency (not in these totals): ${other.map((r) => `${r.vendor_name} ${r.total_amount} ${r.currency}`).slice(0, 5).join('; ')}.` }] : []),
        ],
      });
      tableSheet(wb, {
        sheet: 'Payments', title: 'Payments, in date order', subtitle: sub,
        columns: [{ header: 'Date', type: 'date', width: 11 }, { header: 'Paid to', width: 36 }, { header: 'Amount €', type: 'eur', width: 14, total: 'sum' },
          { header: 'Checked', width: 12 }, { header: 'Original', type: 'link', width: 44 }],
        rows: pays.map(({ r, amt }) => [day(r), r.vendor_name || '', amt, r.needs_review && !r.is_reviewed ? 'NOT CHECKED' : 'yes', { text: docName(r.file_name) || 'Open', url: r.file_url }]),
      });
      tableSheet(wb, {
        sheet: 'By month', title: 'By month', subtitle: sub,
        columns: [{ header: 'Month', width: 18 }, { header: 'Payments', type: 'int', width: 10, total: 'sum' }, { header: 'Amount €', type: 'eur', width: 14, total: 'sum' }],
        rows: byMonth.map((x) => [monthLabel(x.k), x.n, x.amt]),
      });
      tableSheet(wb, {
        sheet: 'By supplier', title: 'By supplier', subtitle: sub,
        columns: [{ header: 'Paid to', width: 36 }, { header: 'Payments', type: 'int', width: 10, total: 'sum' }, { header: 'Amount €', type: 'eur', width: 14, total: 'sum' }, { header: 'Last payment', type: 'date', width: 13 }],
        rows: bySupplier.map((x) => [x.k, x.n, x.amt, x.last]),
      });
      await download(wb, `Carnas payments ${scope === 'all' ? 'all' : scope.slice(2)}.xlsx`);
    } catch (e) { alert(`Export failed: ${e.message}`); } finally { setBusy(false); }
  };

  const th = 'px-4 py-2.5 text-[11px] uppercase tracking-[0.1em] font-medium text-neutral-400';
  const Grouped = ({ title, rows, label }) => (
    <>
      <h2 className="mt-8 mb-2 text-[15px] font-semibold">{title}</h2>
      <div className="bg-white border rule overflow-x-auto">
        <table className="w-full text-[13px] min-w-[360px]">
          <thead className="bg-neutral-50 border-b rule"><tr><th className={`${th} text-left`}>{label}</th><th className={`${th} text-right`}>Payments</th><th className={`${th} text-right`}>Amount</th></tr></thead>
          <tbody className="divide-y divide-neutral-100 font-fig">
            {rows.map((x) => <tr key={x.k}><td className="px-4 py-2.5 font-sans">{label === 'Month' ? monthLabel(x.k) : x.k}</td><td className="px-4 py-2.5 text-right">{x.n}</td><td className="px-4 py-2.5 text-right">{eur(x.amt)}</td></tr>)}
          </tbody>
          <tfoot className="border-t-2 border-neutral-300 bg-neutral-50 font-fig font-semibold"><tr><td className="px-4 py-2.5 font-sans text-[11px] uppercase tracking-[0.1em] text-neutral-500">Total</td><td className="px-4 py-2.5 text-right">{pays.length}</td><td className="px-4 py-2.5 text-right">{eur(total)}</td></tr></tfoot>
        </table>
      </div>
    </>
  );

  return (
    <AppShell title="Reports" subtitle="Everything paid for the house, in euros"
      actions={<button onClick={exportXlsx} disabled={busy || !pays.length} className="inline-flex items-center gap-2 h-9 px-4 bg-neutral-900 text-white text-[13px] disabled:opacity-40">{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />} Excel</button>}>
      <div className="flex flex-wrap gap-2 mb-6">
        {[['all', 'All years'], ...years.map((y) => [`y:${y}`, y])].map(([k, l]) => (
          <button key={k} onClick={() => setScope(k)} className={`h-8 px-3 text-[12px] border ${scope === k ? 'bg-neutral-900 text-white border-neutral-900' : 'bg-white border-neutral-300 text-neutral-600'}`}>{l}</button>
        ))}
      </div>
      {isLoading ? <p className="text-[13px] text-neutral-400">Loading…</p> : !receipts.length ? (
        <div className="bg-white border rule px-5 py-10 text-center text-[13px] text-neutral-500">No payments yet. <Link to={wsPath('/Upload')} className="underline">Upload the first invoices or receipts</Link>.</div>
      ) : (<>
        <StatStrip items={[
          { label: 'Total paid', value: eur(total) },
          { label: 'Payments', value: pays.length, sub: unchecked ? `${unchecked} to check` : 'all checked' },
          { label: 'First', value: longDate(first) },
          { label: 'Latest', value: longDate(last) },
        ]} />
        {unchecked > 0 && <p className="mt-3 text-[12px] text-amber-700">{unchecked} payment{unchecked === 1 ? '' : 's'} still to check — <Link to={wsPath('/Review')} className="underline">open To check</Link>.</p>}
        {other.length > 0 && <p className="mt-2 text-[12px] text-amber-700">{other.length} payment{other.length === 1 ? '' : 's'} in another currency are not included in these euro totals.</p>}
        <Grouped title="By month" rows={byMonth} label="Month" />
        <Grouped title="By supplier" rows={bySupplier} label="Paid to" />
      </>)}
    </AppShell>
  );
}

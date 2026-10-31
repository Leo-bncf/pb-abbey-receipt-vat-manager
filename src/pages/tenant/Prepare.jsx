/* Tenant · Prepare — turns an action into a document ready to check and print:
 * a new-lease proposal, an RPI rent review (with the calculation), a reminder
 * for unpaid amounts, or an internal negotiation pack. Figures on the left,
 * the A4 page on the right; the wording can be edited on the page itself.
 * Nothing is sent: print it or save it as PDF, then send it yourself. */
import React, { useEffect, useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Printer, Copy, Save, Check, Plus, Trash2, Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { base44, supabase } from '@/api/base44Client';
import TenantShell from './TenantShell';
import { fmtDate, EntityDialog } from './ui';
import { mail } from '@/api/mailClient';

const COMPANY = {
  name: 'PB Abbey Ltd',
  email: 'office@pbabbey.com',
  footer: 'PB Abbey Ltd · Registered in England and Wales no. 08819146 · VAT no. 245 3896 76 · Registered office: One New Street, Wells, Somerset BA5 2LA',
  signer: 'P B Bancroft', role: 'Director',
};
const gbp = (n) => `£${(Number(n) || 0).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const gbp0 = (n) => `£${Math.round(Number(n) || 0).toLocaleString('en-GB')}`;
const long = (d) => (d ? new Date(`${String(d).slice(0, 10)}T12:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) : '—');
const monthName = (d) => (d ? new Date(`${String(d).slice(0, 10)}T12:00:00`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }) : '—');
const iso = (d) => d.toISOString().slice(0, 10);
const addDays = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return iso(d); };
const firstOfNextMonth = () => { const d = new Date(); d.setMonth(d.getMonth() + 1, 1); return iso(d); };
const billing = (f) => (f === 'monthly' ? 'monthly in advance' : 'quarterly in advance');

// Which document fits which action.
export function docFor(a) {
  if (a.data?.prepare) return a.data.prepare;
  if (['holding_over', 'lease_end'].includes(a.kind)) return 'renewal';
  if (a.kind === 'review') return 'review';
  if (a.kind === 'arrears') return 'arrears';
  return null;
}

const PRINT_CSS = `
@media print {
  @page { size: A4; margin: 0; }
  body * { visibility: hidden !important; }
  #pb-sheet, #pb-sheet * { visibility: visible !important; }
  #pb-sheet { position: absolute; left: 0; top: 0; width: 210mm; min-height: 297mm; box-shadow: none !important; border: 0 !important; margin: 0 !important; }
}`;

function Field({ label, children, help }) {
  return (
    <label className="block">
      <span className="text-[11px] uppercase tracking-[0.1em] text-neutral-500 block mb-1">{label}</span>
      {children}
      {help && <span className="block text-[11px] text-neutral-400 mt-1">{help}</span>}
    </label>
  );
}
const inputCls = 'h-9 w-full px-2.5 border border-neutral-300 bg-white text-[14px] rounded-md';

// A4 sheet with letterhead. Body is editable in place.
function Sheet({ children, editable = true, sheetKey }) {
  return (
    <div id="pb-sheet" className="bg-white text-neutral-900 border rule shadow-sm mx-auto flex flex-col" style={{ width: '210mm', maxWidth: '100%', minHeight: '297mm', padding: '18mm 20mm 14mm', fontFamily: 'Georgia, "Times New Roman", serif', fontSize: '11pt', lineHeight: 1.5 }}>
      <div className="flex items-start justify-between gap-6 pb-4 mb-6 border-b border-neutral-300" style={{ fontFamily: 'system-ui, sans-serif' }}>
        <div><div style={{ fontSize: '17pt', fontWeight: 600, letterSpacing: '-0.01em' }}>{COMPANY.name}</div><div style={{ fontSize: '8.5pt', color: '#666' }}>Commercial property</div></div>
        <div style={{ fontSize: '8.5pt', color: '#555', textAlign: 'right' }}>{COMPANY.email}</div>
      </div>
      <div key={sheetKey} contentEditable={editable} suppressContentEditableWarning className="flex-1 outline-none focus:bg-amber-50/30">{children}</div>
      <div className="pt-3 mt-8 border-t border-neutral-200" style={{ fontFamily: 'system-ui, sans-serif', fontSize: '7.5pt', color: '#777' }}>{COMPANY.footer}</div>
    </div>
  );
}

// Address lines without repeating the unit name (e.g. "Ambulance Station").
const addrLines = (unit) => {
  const parts = (unit?.address || '').split(',').map((l) => l.trim()).filter(Boolean);
  const ref = (unit?.reference || '').toLowerCase();
  return [unit?.reference, ...parts.filter((l) => l.toLowerCase() !== ref && !(ref && l.toLowerCase().startsWith(`${ref} `) && /^units? /i.test(l)))].filter(Boolean);
};
const place = (unit) => addrLines(unit).join(', ');
function Addressee({ tenant, unit }) {
  return (
    <div className="mb-6">
      <div>{tenant?.name || unit?.tenant_name}</div>
      {addrLines(unit).map((l, i) => <div key={i}>{l}</div>)}
    </div>
  );
}
const Sign = () => (
  <div className="mt-8">
    <p>Yours sincerely,</p>
    <div style={{ height: '16mm' }} />
    <p>{COMPANY.signer}<br />{COMPANY.role}, {COMPANY.name}</p>
  </div>
);


// The A4 page as a PDF (what the tenant receives), sliced over pages if it runs long.
async function sheetPdf() {
  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([import('html2canvas'), import('jspdf')]);
  const el = document.getElementById('pb-sheet');
  const canvas = await html2canvas(el, { scale: 2, backgroundColor: '#ffffff', useCORS: true });
  const pdf = new jsPDF({ unit: 'mm', format: 'a4' });
  const w = 210; const h = (canvas.height * w) / canvas.width; const page = 297;
  const img = canvas.toDataURL('image/jpeg', 0.92);
  if (h <= page * 1.1) { const k = Math.min(1, page / h); pdf.addImage(img, 'JPEG', (w - w * k) / 2, 0, w * k, h * k); } // one page: shrink a touch if it just spills over
  else for (let y = 0, i = 0; y < h - 0.5; y += page, i++) { if (i) pdf.addPage(); pdf.addImage(img, 'JPEG', 0, -y, w, h); }
  return pdf.output('datauristring').split(',')[1];
}

const SUBJECT = { renewal: 'Proposal for a new lease', review: 'Rent review', arrears: 'Amounts outstanding' };

export default function Prepare() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const qc = useQueryClient();
  const [copied, setCopied] = useState(false);

  const aQ = useQuery({ queryKey: ['action', id], queryFn: () => base44.entities.Action.get(id) });
  const a = aQ.data;
  const { data: units = [] } = useQuery({ queryKey: ['units'], queryFn: () => base44.entities.Unit.list('reference') });
  const { data: tenants = [] } = useQuery({ queryKey: ['tenants'], queryFn: () => base44.entities.Tenant.list('name') });
  const { data: payments = [] } = useQuery({ queryKey: ['rent_payments'], queryFn: () => base44.entities.RentPayment.list('-due_date', 5000) });
  const { data: rpi = [] } = useQuery({ queryKey: ['rpi_index'], queryFn: async () => { const { data, error } = await supabase.from('rpi_index').select('month,value').order('month'); if (error) throw error; return data; } });

  const unit = units.find((u) => u.id === a?.unit_id);
  const tenant = tenants.find((t) => t.id === (a?.tenant_id || unit?.tenant_id));
  const doc = params.get('doc') || (a && docFor(a)) || 'pack';

  // Form values, from a saved draft or sensible defaults.
  const [v, setV] = useState(null);
  useEffect(() => {
    if (!a || (a.unit_id && !unit) || v) return;
    const d = a.data || {};
    const rentYear = Math.round((Number(unit?.rent_amount) || 0) * 12 * 100) / 100;
    setV({
      date: addDays(0),
      reply_by: addDays(28),
      // renewal
      start: unit?.lease_end && unit.lease_end > addDays(0) ? (() => { const x = new Date(`${unit.lease_end}T12:00:00`); x.setDate(x.getDate() + 1); return iso(x); })() : firstOfNextMonth(),
      term: 5, review_year: 3,
      rent: Number(unit?.market_rent) > rentYear ? Number(unit.market_rent) : rentYear,
      sc_on_top: !!(unit?.sc_included || Number(unit?.service_charge) > 0),
      // review
      review_date: d.review_date || unit?.next_review || addDays(0),
      base_rent: d.base_rent || rentYear,
      base_month: d.base_month || '', review_month: d.review_month || '',
      billed_rent: rentYear, quarters_billed: null,
      // arrears
      lines: d.lines || payments.filter((p) => (p.tenant_id === a.tenant_id || p.unit_id === a.unit_id) && Number(p.outstanding) > 0)
        .map((p) => ({ label: `Rent ${fmtDate(p.period_start)} – ${fmtDate(p.period_end)} (incl. VAT)`, amount: Number(p.outstanding) })),
      pay_within: 14,
      ...(d.draft?.[doc] || {}),
    });
  }, [a, unit, payments, v, doc]);
  const set = (k, val) => setV((s) => ({ ...s, [k]: val }));

  // RPI calculation
  const rpiAt = (m) => rpi.find((r) => r.month === m)?.value;
  const calc = useMemo(() => {
    if (!v) return null;
    const i0 = Number(rpiAt(v.base_month)); const i1 = Number(rpiAt(v.review_month));
    if (!i0 || !i1) return null;
    const ratio = i1 / i0;
    const newRent = Math.round(Number(v.base_rent) * ratio * 100) / 100;
    // quarters already invoiced at the old rent since the review date
    let q = v.quarters_billed;
    if (q == null || q === '') { q = 0; const d = new Date(`${v.review_date}T12:00:00`); const now = new Date(); while (d <= now) { q += 1; d.setMonth(d.getMonth() + 3); } }
    const diffYear = Math.max(0, newRent - Number(v.billed_rent || 0));
    return { i0, i1, ratio, pct: (ratio - 1) * 100, newRent, q: Number(q), owed: Math.round((diffYear / 4) * Number(q) * 100) / 100, diffYear };
  }, [v, rpi]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = useMutation({
    mutationFn: (extra = {}) => base44.entities.Action.update(a.id, { data: { ...(a.data || {}), draft: { ...(a.data?.draft || {}), [doc]: v }, ...extra }, updated_date: new Date().toISOString() }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['action', id] }); qc.invalidateQueries({ queryKey: ['actions'] }); },
  });

  const [sending, setSending] = useState(false);
  const send = useMutation({
    mutationFn: async (f) => {
      if (!f.checked) throw new Error('Tick “I have read the letter” first.');
      const pdf = await sheetPdf();
      const filename = `${(SUBJECT[doc] || 'Letter').replace(/\s+/g, ' ')} - ${unit?.reference || ''} - ${v.date}.pdf`.replace(/[\\/:*?"<>|]/g, '-');
      const text = f.message;
      const html = `<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.5">${f.message.split('\n').map((l) => (l ? `<p style="margin:0 0 10px">${l.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</p>` : '')).join('')}</div>`;
      await mail.send('office', { to: f.to, cc: f.cc || '', subject: f.subject, text, html, attachments: [{ filename, contentType: 'application/pdf', content_base64: pdf }] });
      const sent = [...(a.data?.sent || []), { doc, to: f.to, subject: f.subject, at: new Date().toISOString() }];
      await base44.entities.Action.update(a.id, { data: { ...(a.data || {}), sent, draft: { ...(a.data?.draft || {}), [doc]: v } }, updated_date: new Date().toISOString() });
    },
    onSuccess: () => { setSending(false); qc.invalidateQueries({ queryKey: ['action', id] }); qc.invalidateQueries({ queryKey: ['actions'] }); },
  });
  const copy = async () => {
    const t = document.getElementById('pb-sheet')?.innerText || '';
    try { await navigator.clipboard.writeText(t); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* ignore */ }
  };

  if (aQ.isLoading || !v) return <TenantShell title="Prepare"><p className="text-[13px] text-neutral-400">Loading…</p></TenantShell>;
  if (!a) return <TenantShell title="Prepare"><p className="text-[13px] text-red-700">This action no longer exists.</p></TenantShell>;

  const title = { renewal: 'New lease proposal', review: 'Rent review', arrears: 'Payment reminder', pack: 'Negotiation pack' }[doc];
  const months = rpi.map((r) => r.month).reverse();
  const total = (v.lines || []).reduce((s, l) => s + (Number(l.amount) || 0), 0);
  const sheetKey = JSON.stringify(v);

  // ---------- the page content per document
  let body;
  if (doc === 'renewal') {
    const ended = unit?.lease_end && unit.lease_end < addDays(0);
    body = (<>
      <p className="mb-6">{long(v.date)}</p>
      <Addressee tenant={tenant} unit={unit} />
      <p className="mb-4"><b>Subject to contract</b></p>
      <p className="mb-4">Dear {tenant?.name || unit?.tenant_name},</p>
      <p className="mb-4"><b>{place(unit)}</b></p>
      <p className="mb-3">{ended ? `Your lease of the above premises ended on ${long(unit.lease_end)} and you have remained in occupation since then.` : `Your lease of the above premises ends on ${long(unit?.lease_end)}.`} We value you as a tenant and would like to agree a new lease with you.</p>
      <p className="mb-2">We propose the following terms, subject to contract:</p>
      <ul className="mb-3 pl-6 list-disc">
        <li>Term: {v.term} years from {long(v.start)}</li>
        <li>Rent: {gbp(v.rent)} a year, exclusive of VAT, payable {billing(unit?.rent_frequency)}</li>
        {Number(v.review_year) > 0 && Number(v.review_year) < Number(v.term) && <li>Rent review: at the end of year {v.review_year}</li>}
        {v.sc_on_top && <li>Service charge: payable in addition to the rent, in the same way as the other tenants of the building</li>}
        <li>Other terms: as your current lease, updated where needed</li>
      </ul>
      <p className="mb-3">We would be grateful if you could let us know by {long(v.reply_by)} whether these terms are acceptable, or contact us to discuss them.</p>
      <Sign />
    </>);
  } else if (doc === 'review') {
    body = calc ? (<>
      <p className="mb-6">{long(v.date)}</p>
      <Addressee tenant={tenant} unit={unit} />
      <p className="mb-4">Dear Sir or Madam,</p>
      <p className="mb-4"><b>Rent review on {long(v.review_date)}: {place(unit)}</b></p>
      <p className="mb-3">Under the lease, the rent is reviewed on {long(v.review_date)} in line with the Retail Prices Index (RPI All Items, published by the Office for National Statistics).</p>
      <table className="mb-3 w-full" style={{ borderCollapse: 'collapse' }}><tbody>
        {[['RPI, ' + monthName(v.base_month), calc.i0.toFixed(1)], ['RPI, ' + monthName(v.review_month), calc.i1.toFixed(1)], ['Increase', `${calc.pct.toFixed(2)}%`],
          ['Rent before the review', `${gbp(v.base_rent)} a year`], ['Rent from ' + long(v.review_date), `${gbp(calc.newRent)} a year`]].map(([k, val]) => (
          <tr key={k}><td style={{ padding: '3px 0', borderBottom: '1px solid #e5e5e5' }}>{k}</td><td style={{ padding: '3px 0', borderBottom: '1px solid #e5e5e5', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{val}</td></tr>))}
      </tbody></table>
      <p className="mb-3">The rent from {long(v.review_date)} is therefore {gbp(calc.newRent)} a year, exclusive of VAT, payable {billing(unit?.rent_frequency)}.</p>
      {calc.owed > 0 && <p className="mb-3">{calc.q === 1 ? 'The quarter' : `The ${calc.q} quarters`} from {long(v.review_date)} {calc.q === 1 ? 'was' : 'were'} invoiced at {gbp(v.billed_rent)} a year. We will send an invoice for the difference of {gbp(calc.owed)} plus VAT, and future invoices will be at the new rent.</p>}
      <p className="mb-3">Please contact us if you have any questions.</p>
      <Sign />
    </>) : <p>Choose the two RPI months on the left.</p>;
  } else if (doc === 'arrears') {
    body = (<>
      <p className="mb-6">{long(v.date)}</p>
      <Addressee tenant={tenant} unit={unit} />
      <p className="mb-4">Dear {tenant?.name || unit?.tenant_name},</p>
      <p className="mb-4"><b>Amounts outstanding: {place(unit)}</b></p>
      <p className="mb-3">Our records show the following amounts as unpaid:</p>
      <table className="mb-3 w-full" style={{ borderCollapse: 'collapse' }}><tbody>
        {(v.lines || []).map((l, i) => <tr key={i}><td style={{ padding: '3px 0', borderBottom: '1px solid #e5e5e5' }}>{l.label}</td><td style={{ padding: '3px 0', borderBottom: '1px solid #e5e5e5', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{gbp(l.amount)}</td></tr>)}
        <tr><td style={{ padding: '5px 0', fontWeight: 600 }}>Total</td><td style={{ padding: '5px 0', fontWeight: 600, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{gbp(total)}</td></tr>
      </tbody></table>
      <p className="mb-3">We would be grateful if you could arrange payment within {v.pay_within} days, to the account shown on our invoices.</p>
      <p className="mb-3">If you have already paid, thank you, and please let us know the date of payment so that we can match it.</p>
      <Sign />
    </>);
  } else {
    const rentYear = (Number(unit?.rent_amount) || 0) * 12;
    const mine = payments.filter((p) => p.unit_id === unit?.id);
    const late = mine.filter((p) => p.payment_date && p.due_date && (new Date(p.payment_date) - new Date(p.due_date)) / 86400000 > 14).length;
    const psf = (n) => (Number(unit?.area_sqft) > 0 ? `· £${(n / unit.area_sqft).toFixed(2)} / sq ft` : '');
    const comps = v.comps || [];
    body = (<>
      <p className="mb-1" style={{ fontFamily: 'system-ui, sans-serif', fontSize: '8pt', letterSpacing: '0.08em', textTransform: 'uppercase', color: '#888' }}>Internal · not for the tenant</p>
      <p className="mb-4" style={{ fontSize: '15pt', fontWeight: 600 }}>{unit?.reference} · {unit?.tenant_name || 'vacant'}</p>
      <table className="mb-5 w-full" style={{ borderCollapse: 'collapse', fontSize: '10pt' }}><tbody>
        {[['Property', unit?.site || unit?.address], ['Area', unit?.area_sqft ? `${Number(unit.area_sqft).toLocaleString('en-GB')} sq ft` : '—'],
          ['Lease', `${fmtDate(unit?.lease_start)} → ${fmtDate(unit?.lease_end)}${unit?.break_date ? ` · break ${fmtDate(unit.break_date)}` : ''}`],
          ['Rent now', `${gbp0(rentYear)} a year ${psf(rentYear)}`], ['Market rent (estimate)', unit?.market_rent ? `${gbp0(unit.market_rent)} a year ${psf(unit.market_rent)}` : '—'],
          ['Gap', unit?.market_rent ? `${gbp0(Math.max(0, unit.market_rent - rentYear))} a year` : '—'],
          ['Service charge', unit?.service_charge ? `${gbp0(unit.service_charge)} a year${unit.sc_included ? ' — included in the rent, paid by PB Abbey' : ''}` : '—'],
          ['Payment record', mine.length ? `${mine.length} rent line${mine.length === 1 ? '' : 's'} in the app, ${late} paid more than 14 days late` : 'No rent recorded in the app yet'],
          ['Notes', unit?.notes || '—']].map(([k, val]) => (
          <tr key={k}><td style={{ padding: '4px 12px 4px 0', borderBottom: '1px solid #eee', color: '#666', width: '34%', verticalAlign: 'top' }}>{k}</td><td style={{ padding: '4px 0', borderBottom: '1px solid #eee' }}>{val}</td></tr>))}
      </tbody></table>
      <p className="mb-2" style={{ fontWeight: 600 }}>Comparable lettings</p>
      {comps.length ? <table className="mb-5 w-full" style={{ borderCollapse: 'collapse', fontSize: '10pt' }}><tbody>
        {comps.map((c, i) => <tr key={i}><td style={{ padding: '3px 8px 3px 0', borderBottom: '1px solid #eee' }}>{c.address}</td><td style={{ padding: '3px 8px', borderBottom: '1px solid #eee', textAlign: 'right' }}>{c.sqft ? `${c.sqft} sq ft` : ''}</td><td style={{ padding: '3px 8px', borderBottom: '1px solid #eee', textAlign: 'right' }}>{c.rent ? gbp0(c.rent) : ''}</td><td style={{ padding: '3px 0', borderBottom: '1px solid #eee', textAlign: 'right' }}>{c.sqft && c.rent ? `£${(c.rent / c.sqft).toFixed(2)}/sq ft` : ''}</td></tr>)}
      </tbody></table> : <p className="mb-5" style={{ color: '#888' }}>None added yet. Add similar units to let nearby (asking rents from online listings) on the left.</p>}
      <p className="mb-2" style={{ fontWeight: 600 }}>Plan</p>
      <ul className="pl-6 list-disc" style={{ fontSize: '10pt' }}>
        <li>Opening proposal: {gbp0(unit?.market_rent || rentYear)} a year{unit?.sc_included ? ', service charge on top' : ''}.</li>
        <li>Lowest acceptable: decide before the meeting.</li>
        <li>Keep it friendly: an empty unit costs more than a modest discount.</li>
      </ul>
    </>);
  }

  return (
    <TenantShell title={title} subtitle={`${a.title}`} actions={<>
      <Link to="/tenant/actions" className="h-9 px-3 inline-flex items-center gap-1.5 text-[13px] border border-neutral-300 bg-white text-neutral-600 hover:text-neutral-900"><ArrowLeft className="w-4 h-4" /> Actions</Link>
    </>}>
      <style>{PRINT_CSS}</style>
      <div className="flex flex-col xl:flex-row gap-6 items-start">
        <aside className="w-full xl:w-80 shrink-0 bg-white border rule p-4 flex flex-col gap-3">
          <div className="flex flex-wrap gap-1.5">
            {(['holding_over', 'lease_end', 'break'].includes(a.kind) || doc === 'renewal' || doc === 'pack') && ['renewal', 'pack'].map((k) => (
              <Link key={k} to={`/tenant/prepare/${a.id}?doc=${k}`} onClick={() => setV(null)} className={`h-8 px-3 inline-flex items-center text-[12px] border ${doc === k ? 'bg-neutral-900 text-white border-neutral-900' : 'border-neutral-300 text-neutral-600'}`}>{k === 'renewal' ? 'Letter to tenant' : 'Negotiation pack'}</Link>
            ))}
          </div>
          {doc !== 'pack' && <Field label="Date of the letter"><input type="date" className={inputCls} value={v.date} onChange={(e) => set('date', e.target.value)} /></Field>}

          {doc === 'renewal' && <>
            <Field label="New lease starts"><input type="date" className={inputCls} value={v.start} onChange={(e) => set('start', e.target.value)} /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Term (years)"><input type="number" className={inputCls} value={v.term} onChange={(e) => set('term', e.target.value)} /></Field>
              <Field label="Review after (years)"><input type="number" className={inputCls} value={v.review_year} onChange={(e) => set('review_year', e.target.value)} /></Field>
            </div>
            <Field label="Rent a year, excl. VAT (£)" help={`Now ${gbp0((Number(unit?.rent_amount) || 0) * 12)}${unit?.market_rent ? ` · market about ${gbp0(unit.market_rent)}` : ''}`}><input type="number" step="50" className={inputCls} value={v.rent} onChange={(e) => set('rent', e.target.value)} /></Field>
            <label className="flex items-center gap-2 text-[13px]"><input type="checkbox" checked={!!v.sc_on_top} onChange={(e) => set('sc_on_top', e.target.checked)} /> Service charge on top of the rent</label>
            <Field label="Reply by"><input type="date" className={inputCls} value={v.reply_by} onChange={(e) => set('reply_by', e.target.value)} /></Field>
          </>}

          {doc === 'review' && <>
            <Field label="Review date"><input type="date" className={inputCls} value={v.review_date} onChange={(e) => set('review_date', e.target.value)} /></Field>
            <Field label="Rent before the review, a year (£)"><input type="number" className={inputCls} value={v.base_rent} onChange={(e) => set('base_rent', e.target.value)} /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="RPI from"><select className={inputCls} value={v.base_month} onChange={(e) => set('base_month', e.target.value)}><option value="">Month…</option>{months.map((m) => <option key={m} value={m}>{monthName(m)}</option>)}</select></Field>
              <Field label="RPI to"><select className={inputCls} value={v.review_month} onChange={(e) => set('review_month', e.target.value)}><option value="">Month…</option>{months.map((m) => <option key={m} value={m}>{monthName(m)}</option>)}</select></Field>
            </div>
            <p className="text-[11px] text-neutral-500 -mt-1">Check in the lease which RPI months the review uses. Some leases also have a cap or a floor.</p>
            <Field label="Rent invoiced since the review, a year (£)"><input type="number" className={inputCls} value={v.billed_rent} onChange={(e) => set('billed_rent', e.target.value)} /></Field>
            <Field label="Quarters already invoiced at that rent" help="Left empty, counted from the review date"><input type="number" className={inputCls} value={v.quarters_billed ?? ''} onChange={(e) => set('quarters_billed', e.target.value === '' ? null : e.target.value)} /></Field>
            {calc && <div className="text-[13px] bg-neutral-50 border rule p-3 font-fig">
              <div>RPI {calc.i0.toFixed(1)} → {calc.i1.toFixed(1)} = <b>+{calc.pct.toFixed(2)}%</b></div>
              <div>New rent <b>{gbp(calc.newRent)}</b> a year</div>
              <div className={calc.diffYear > 0 ? 'text-emerald-700' : ''}>{gbp0(calc.diffYear)} a year more than invoiced</div>
              {calc.owed > 0 && <div className="text-emerald-700">Catch-up for {calc.q} quarter{calc.q > 1 ? 's' : ''}: <b>{gbp(calc.owed)}</b> + VAT</div>}
            </div>}
          </>}

          {doc === 'arrears' && <>
            <p className="text-[11px] uppercase tracking-[0.1em] text-neutral-500">Amounts</p>
            {(v.lines || []).map((l, i) => (
              <div key={i} className="flex gap-1.5">
                <input className={`${inputCls} flex-1 min-w-0`} value={l.label} onChange={(e) => set('lines', v.lines.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} />
                <input type="number" className={`${inputCls} w-24`} value={l.amount} onChange={(e) => set('lines', v.lines.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x)))} />
                <button className="px-1.5 text-neutral-400 hover:text-red-600" onClick={() => set('lines', v.lines.filter((_, j) => j !== i))} title="Remove"><Trash2 className="w-3.5 h-3.5" /></button>
              </div>
            ))}
            <button className="self-start text-[12px] underline text-neutral-600" onClick={() => set('lines', [...(v.lines || []), { label: '', amount: 0 }])}><Plus className="inline w-3 h-3" /> Add a line</button>
            <Field label="Pay within (days)"><input type="number" className={inputCls} value={v.pay_within} onChange={(e) => set('pay_within', e.target.value)} /></Field>
            <p className="text-[11px] text-neutral-500">Check first that these are still unpaid.</p>
          </>}

          {doc === 'pack' && <>
            <p className="text-[11px] uppercase tracking-[0.1em] text-neutral-500">Comparable lettings</p>
            {(v.comps || []).map((c, i) => (
              <div key={i} className="grid grid-cols-[1fr_4.5rem_5rem_auto] gap-1.5">
                <input placeholder="Address / listing" className={`${inputCls} min-w-0`} value={c.address} onChange={(e) => set('comps', v.comps.map((x, j) => (j === i ? { ...x, address: e.target.value } : x)))} />
                <input type="number" placeholder="sq ft" className={inputCls} value={c.sqft} onChange={(e) => set('comps', v.comps.map((x, j) => (j === i ? { ...x, sqft: e.target.value } : x)))} />
                <input type="number" placeholder="£ / year" className={inputCls} value={c.rent} onChange={(e) => set('comps', v.comps.map((x, j) => (j === i ? { ...x, rent: e.target.value } : x)))} />
                <button className="px-1 text-neutral-400 hover:text-red-600" onClick={() => set('comps', v.comps.filter((_, j) => j !== i))} title="Remove"><Trash2 className="w-3.5 h-3.5" /></button>
              </div>
            ))}
            <button className="self-start text-[12px] underline text-neutral-600" onClick={() => set('comps', [...(v.comps || []), { address: '', sqft: '', rent: '' }])}><Plus className="inline w-3 h-3" /> Add a comparable</button>
          </>}

          <div className="pt-2 border-t rule flex flex-col gap-2">
            {doc !== 'pack' && <Button onClick={() => { send.reset(); setSending(true); }} className="gap-2 bg-neutral-900 hover:bg-neutral-800"><Send className="w-4 h-4" /> Send by email…</Button>}
            {(a.data?.sent || []).filter((x) => x.doc === doc).map((x, i) => <p key={i} className="text-[12px] text-emerald-700">Sent to {x.to} on {fmtDate(x.at)}</p>)}
            <Button variant={doc === 'pack' ? 'default' : 'outline'} onClick={() => window.print()} className={doc === 'pack' ? 'gap-2 bg-neutral-900 hover:bg-neutral-800' : 'gap-2 border-neutral-300'}><Printer className="w-4 h-4" /> Print or save as PDF</Button>
            <div className="grid grid-cols-2 gap-2">
              <Button variant="outline" className="gap-1.5 border-neutral-300" onClick={copy}>{copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />} {copied ? 'Copied' : 'Copy text'}</Button>
              <Button variant="outline" className="gap-1.5 border-neutral-300" onClick={() => save.mutate({})} disabled={save.isPending}>{save.isSuccess ? <Check className="w-4 h-4" /> : <Save className="w-4 h-4" />} {save.isSuccess ? 'Saved' : 'Save'}</Button>
            </div>
            <p className="text-[11px] text-neutral-400">Nothing leaves without “Send now” in the next step. You can change the wording directly on the page first.</p>
          </div>
        </aside>
        <div className="flex-1 min-w-0 w-full overflow-x-auto">
          <Sheet sheetKey={sheetKey} editable>{body}</Sheet>
        </div>
      </div>
      <EntityDialog open={sending} onClose={() => setSending(false)} title="Send this letter by email" submitLabel={send.isPending ? 'Sending…' : 'Send now'}
        intro={`From office@pbabbey.com, with the letter attached as a PDF exactly as shown. A copy goes to Sent.`}
        fields={[
          { name: 'to', label: 'To', type: 'email', required: true, help: tenant?.email ? '' : 'No email saved for this tenant: add it in Tenants, or type it here.' },
          { name: 'cc', label: 'Cc (optional)' },
          { name: 'subject', label: 'Subject', required: true },
          { name: 'message', label: 'Message', type: 'textarea' },
          { name: 'checked', label: 'I have read the letter and it is right to send', type: 'checkbox' },
        ]}
        initial={sending ? { to: tenant?.email || '', subject: `${SUBJECT[doc] || 'Letter'}: ${place(unit)}`, checked: false,
          message: `Dear ${tenant?.name || unit?.tenant_name || 'Sir or Madam'},\n\nPlease find attached our letter of ${long(v.date)}.\n\nKind regards,\n\nPeter Bancroft\nPB Abbey Ltd` } : null}
        onSubmit={(f) => send.mutate(f)} submitting={send.isPending} error={send.error} />
    </TenantShell>
  );
}

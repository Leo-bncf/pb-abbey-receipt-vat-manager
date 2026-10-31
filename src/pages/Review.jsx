/* Review queue: one receipt at a time, the cropped ticket next to editable
 * fields. Validate (Enter) saves the corrections, logs each changed field to
 * receipt_corrections, and moves on. Designed for Christine's monthly check. */
import { workspace } from '@/lib/workspace';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Check, ChevronLeft, ChevronRight, Trash2, AlertTriangle, RefreshCw, PartyPopper } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { base44 } from '@/api/base44Client';
import { useAuth } from '@/lib/AuthContext';
import AppShell from '@/components/AppShell';
import ReceiptCrop from '@/components/receipts/ReceiptCrop';

const FIELDS = ['vendor_name', 'receipt_date', 'total_amount', 'currency', 'vat_amount', 'vat_rate', 'country'];
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const vatFromRate = (total, rate) => (rate ? r2(total - total / (1 + rate / 100)) : 0);

// Why this receipt is in the queue, in plain words.
function reasons(r) {
  const out = [];
  if (r.verification && r.verification !== 'OK') {
    const v = { 'amount differs': 'the two readers found different amounts', 'date differs': 'the two readers found different dates',
      'seen by one reader only': 'only one reader found this receipt (could be a duplicate or a card slip)' }[r.verification] || r.verification;
    out.push(v);
  }
  const m = (r.extraction_notes || '').match(/\[Review needed: ([^\]]+)\]/);
  if (m) m[1].split(', ').filter((x) => !x.startsWith('second reader')).forEach((x) => out.push(x));
  if (!r.vendor_name) out.push('no shop name');
  return [...new Set(out)];
}

export default function Review() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const { data: receipts = [], isLoading } = useQuery({
    queryKey: ['receipts', 'review'],
    queryFn: () => base44.entities.Receipt.filter({ needs_review: true, is_reviewed: false }, 'file_name', 5000),
  });
  const queue = useMemo(() => [...receipts].sort((a, b) =>
    (a.file_name || '').localeCompare(b.file_name || '', undefined, { numeric: true }) || (a.page_number || 0) - (b.page_number || 0)), [receipts]);
  const [idx, setIdx] = useState(0);
  const cur = queue[Math.min(idx, Math.max(0, queue.length - 1))];
  const [form, setForm] = useState({});
  const firstInput = useRef(null);

  useEffect(() => {
    if (!cur) return;
    setForm(Object.fromEntries(FIELDS.map((f) => [f, cur[f] ?? ''])));
    setTimeout(() => firstInput.current?.focus(), 50);
  }, [cur?.id]);

  const set = (k, v) => setForm((s) => ({ ...s, [k]: v }));

  const validate = useMutation({
    mutationFn: async () => {
      const clean = {
        vendor_name: String(form.vendor_name || '').trim(),
        receipt_date: form.receipt_date || null,
        total_amount: r2(form.total_amount),
        currency: form.currency || workspace().currency,
        vat_amount: r2(form.vat_amount),
        vat_rate: Number(form.vat_rate) || 0,
        country: form.country || '',
      };
      // Log every field Christine changed (feeds the corrections history).
      const changed = FIELDS.filter((f) => String(cur[f] ?? '') !== String(clean[f] ?? ''));
      for (const f of changed) {
        await base44.entities.ReceiptCorrection.create({
          receipt_id: cur.id, field_name: f, original_value: String(cur[f] ?? ''), corrected_value: String(clean[f] ?? ''),
          correction_reason: reasons(cur).join('; ') || 'review', corrected_by: user?.email || '',
        });
      }
      await base44.entities.Receipt.update(cur.id, {
        ...clean, is_reviewed: true, needs_review: false, status: 'reviewed',
        reviewed_by: user?.email || '', reviewed_date: new Date().toISOString(),
      });
      return changed.length;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['receipts'] }); },
  });

  const remove = useMutation({
    mutationFn: () => base44.entities.Receipt.delete(cur.id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['receipts'] }); },
  });

  // Keyboard: Enter = validate (from any field), Ctrl/⌘ + ← / → = previous / skip.
  useEffect(() => {
    const onKey = (e) => {
      if (!cur) return;
      if ((e.metaKey || e.ctrlKey) && e.key === 'ArrowRight') { e.preventDefault(); setIdx((i) => Math.min(i + 1, queue.length - 1)); }
      if ((e.metaKey || e.ctrlKey) && e.key === 'ArrowLeft') { e.preventDefault(); setIdx((i) => Math.max(i - 1, 0)); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [cur, queue.length]);

  if (isLoading) return <AppShell title="To check"><p className="text-[13px] text-neutral-400">Loading…</p></AppShell>;

  if (!cur) {
    return (
      <AppShell title="To check" subtitle="Receipts the scanner wasn't sure about">
        <div className="bg-white border rule p-12 text-center">
          <PartyPopper className="w-8 h-8 mx-auto text-emerald-600 mb-3" strokeWidth={1.5} />
          <p className="text-[15px] font-medium">Nothing left to check.</p>
          <p className="text-[13px] text-neutral-500 mt-1">Every receipt has been read twice or validated by hand.</p>
        </div>
      </AppShell>
    );
  }

  const why = reasons(cur);
  const sel = 'h-9 w-full rounded border border-neutral-300 bg-white px-2 text-[13px]';
  const lbl = 'text-[11px] uppercase tracking-[0.1em] text-neutral-500 block mb-1';
  const missing = [
    !String(form.vendor_name ?? '').trim() && 'shop',
    !form.receipt_date && 'date',
    String(form.total_amount ?? '').trim() === '' && 'total',
  ].filter(Boolean);
  const rateMismatch = !cur.vat_explicit && Number(form.vat_rate) > 0 && Math.abs(vatFromRate(Number(form.total_amount), Number(form.vat_rate)) - Number(form.vat_amount)) > 0.011;

  return (
    <AppShell title="To check" subtitle={`${idx + 1} of ${queue.length} · ${cur.file_name || ''}`}
      actions={<div className="flex gap-2">
        <Button variant="outline" className="border-neutral-300" disabled={idx === 0} onClick={() => setIdx(idx - 1)}><ChevronLeft className="w-4 h-4" /></Button>
        <Button variant="outline" className="border-neutral-300" disabled={idx >= queue.length - 1} onClick={() => setIdx(idx + 1)}>Skip <ChevronRight className="w-4 h-4 ml-1" /></Button>
      </div>}>
      <div className="grid lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] gap-6">
        <div className="bg-neutral-900 border rule h-[72vh] min-h-[420px]">
          <ReceiptCrop fileUrl={cur.file_url} fileType={cur.file_type} pageNumber={cur.page_number} box={cur.box_2d} className="w-full h-full" />
        </div>

        <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); if (missing.length === 0) validate.mutate(); }}>
          <div className="border border-amber-200 bg-amber-50 px-4 py-3">
            <p className="text-[13px] font-semibold text-amber-900 flex items-center gap-2"><AlertTriangle className="w-4 h-4" /> Why it needs a look</p>
            <ul className="mt-1 text-[13px] text-amber-900 list-disc pl-5">{(why.length ? why : ['flagged by the scanner']).map((w) => <li key={w}>{w}</li>)}</ul>
            {cur.verification === 'amount differs' && cur.verifier_amount != null && (
              <button type="button" className="mt-2 text-[12px] underline text-amber-900" onClick={() => set('total_amount', cur.verifier_amount)}>
                Use the second reader's amount ({cur.verifier_amount})
              </button>
            )}
            {cur.verification === 'date differs' && cur.verifier_date && (
              <button type="button" className="mt-2 text-[12px] underline text-amber-900" onClick={() => set('receipt_date', cur.verifier_date)}>
                Use the second reader's date ({cur.verifier_date.split('-').reverse().join('/')})
              </button>
            )}
          </div>

          <div className="bg-white border rule p-4 grid grid-cols-2 gap-3">
            <div className="col-span-2"><label className={lbl}>Shop</label><Input ref={firstInput} value={form.vendor_name} onChange={(e) => set('vendor_name', e.target.value)} className="h-9" /></div>
            <div><label className={lbl}>Date</label><Input type="date" value={form.receipt_date || ''} onChange={(e) => set('receipt_date', e.target.value)} className="h-9" /></div>
            <div><label className={lbl}>Country</label>
              <select className={sel} value={form.country} onChange={(e) => set('country', e.target.value)}>
                {['United Kingdom', 'France', ...(form.country && !['United Kingdom', 'France'].includes(form.country) ? [form.country] : [])].map((c) => <option key={c}>{c}</option>)}
              </select></div>
            <div><label className={lbl}>Total paid</label><Input type="number" step="0.01" value={form.total_amount} onChange={(e) => set('total_amount', e.target.value)} className="h-9 font-fig" /></div>
            <div><label className={lbl}>Currency</label>
              <select className={sel} value={form.currency || workspace().currency} onChange={(e) => set('currency', e.target.value)}><option>{workspace().currency}</option><option>{workspace().currency === 'EUR' ? 'GBP' : 'EUR'}</option></select></div>
            <div><label className={lbl}>VAT rate</label>
              <select className={sel} value={String(Number(form.vat_rate) || 0)} onChange={(e) => set('vat_rate', Number(e.target.value))}>
                <option value="20">20%</option><option value="5">5%</option><option value="0">0% / none</option></select></div>
            <div><label className={lbl}>VAT amount</label><Input type="number" step="0.01" value={form.vat_amount} onChange={(e) => set('vat_amount', e.target.value)} className="h-9 font-fig" /></div>
            {rateMismatch && (
              <button type="button" onClick={() => set('vat_amount', vatFromRate(Number(form.total_amount), Number(form.vat_rate)))}
                className="col-span-2 text-left text-[12px] text-neutral-600 hover:text-neutral-900 flex items-center gap-1.5">
                <RefreshCw className="w-3.5 h-3.5" /> Recalculate VAT from {form.vat_rate}% of {form.total_amount} → {vatFromRate(Number(form.total_amount), Number(form.vat_rate)).toFixed(2)}
              </button>
            )}
            {cur.vat_inferred && <p className="col-span-2 text-[12px] text-neutral-500">VAT rate was inferred — it isn't printed on the receipt.</p>}
          </div>

          <div className="flex items-center gap-2">
            <Button type="submit" className="flex-1 bg-neutral-900 hover:bg-neutral-800 h-10" disabled={validate.isPending || missing.length > 0}>
              <Check className="w-4 h-4 mr-1.5" /> {validate.isPending ? 'Saving…' : 'Validate'} <span className="ml-2 text-[11px] text-neutral-400">Enter</span>
            </Button>
            <Button type="button" variant="outline" className="h-10 border-neutral-300 text-red-600 hover:text-red-700" disabled={remove.isPending}
              onClick={() => { if (confirm('Delete this line? Use this when it is not a real receipt (duplicate, card slip, item line).')) remove.mutate(); }}>
              <Trash2 className="w-4 h-4 mr-1.5" /> Not a receipt
            </Button>
          </div>
          {missing.length > 0 && <p className="text-[12px] text-amber-800">Fill in the {missing.join(', ')} before validating — read it on the receipt (handwritten dates count).</p>}
          {(validate.isError || remove.isError) && <p className="text-[12px] text-red-600">{String((validate.error || remove.error)?.message)}</p>}
          <p className="text-[11px] text-neutral-400">Enter validates · Ctrl/⌘ + ← → moves between receipts · validated lines leave the queue</p>
        </form>
      </div>
    </AppShell>
  );
}

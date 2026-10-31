/* Shared ledger-style bits for the Tenant app: table primitives + a generic
 * add/edit dialog driven by a field spec. Keeps the CRUD pages small. */
import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

export const gbp = (n) => `£${(Number(n) || 0).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export const fmtDate = (d) => (d ? new Date(d).toLocaleDateString('en-GB') : '—');

export const Th = ({ children, right }) => (
  <th className={`px-4 py-2.5 text-[11px] uppercase tracking-[0.1em] font-medium text-neutral-400 ${right ? 'text-right' : 'text-left'}`}>{children}</th>
);

export function TableWrap({ children }) {
  return (
    <div className="bg-white border rule overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">{children}</table>
      </div>
    </div>
  );
}

// fields: [{ name, label, type?: 'text'|'number'|'email'|'date'|'month'|'select'|'textarea'|'checkbox', options?, required?, placeholder?, help?, half? }]
// onChange(values, name) lets a page fill other fields (e.g. picking a unit fills the rent).
export function EntityDialog({ open, onClose, title, fields, initial, onSubmit, submitting, error, onChange, submitLabel = 'Save', intro }) {
  const [v, setV] = useState({});
  useEffect(() => { if (open) setV(initial || {}); }, [open, initial]);
  const set = (k, val) => setV((s) => { const n = { ...s, [k]: val }; return onChange ? { ...n, ...(onChange(n, k) || {}) } : n; });
  const submit = (e) => { e.preventDefault(); onSubmit(v); };
  const label = (f) => (
    <label className="text-[11px] uppercase tracking-[0.1em] text-neutral-500 block mb-1">
      {f.label}{f.required && <span className="text-red-500"> *</span>}
    </label>
  );

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-md max-h-[92vh] overflow-y-auto">
        <DialogHeader><DialogTitle className="text-base">{title}</DialogTitle></DialogHeader>
        {intro && <p className="text-[12px] text-neutral-500 -mt-1">{intro}</p>}
        <form onSubmit={submit} className="grid grid-cols-2 gap-3">
          {fields.filter((f) => !f.hidden || !f.hidden(v)).map((f) => (
            <div key={f.name} className={f.half ? 'col-span-1' : 'col-span-2'}>
              {f.type === 'checkbox' ? (
                <label className="flex items-start gap-2 text-[13px] text-neutral-700 cursor-pointer select-none">
                  <input type="checkbox" checked={!!v[f.name]} onChange={(e) => set(f.name, e.target.checked)} className="mt-0.5 accent-neutral-900" />
                  <span>{f.label}{f.help && <span className="block text-[11px] text-neutral-400">{f.help}</span>}</span>
                </label>
              ) : (<>
                {label(f)}
                {f.type === 'select' ? (
                  // Native select: reliable on phones, and an empty value ("— none —") works.
                  <select value={v[f.name] ?? ''} onChange={(e) => set(f.name, e.target.value)} required={f.required}
                    className="h-9 w-full px-2 border border-neutral-300 bg-white text-[14px] rounded-md">
                    {!f.options.some((o) => o.value === '') && <option value="" disabled>{f.placeholder || 'Select…'}</option>}
                    {f.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                ) : f.type === 'textarea' ? (
                  <textarea value={v[f.name] ?? ''} onChange={(e) => set(f.name, e.target.value)} rows={3} placeholder={f.placeholder}
                    className="w-full px-3 py-2 border border-neutral-300 bg-white text-[14px] rounded-md" />
                ) : (
                  <Input
                    type={['number', 'date', 'email', 'month'].includes(f.type) ? f.type : 'text'}
                    inputMode={f.type === 'number' ? 'decimal' : undefined}
                    step={f.type === 'number' ? '0.01' : undefined}
                    value={v[f.name] ?? ''}
                    onChange={(e) => set(f.name, f.type === 'number' ? (e.target.value === '' ? '' : Number(e.target.value)) : e.target.value)}
                    required={f.required}
                    placeholder={f.placeholder}
                    className="h-9 bg-white border-neutral-300"
                  />
                )}
                {f.help && <p className="text-[11px] text-neutral-400 mt-1">{f.help}</p>}
              </>)}
            </div>
          ))}
          {error && <p className="col-span-2 text-[12px] text-red-600 bg-red-50 border border-red-200 px-3 py-2">Could not save: {String(error.message || error)}</p>}
          <DialogFooter className="col-span-2 pt-2 gap-2">
            <Button type="button" variant="outline" className="border-neutral-300" onClick={onClose}>Cancel</Button>
            <Button type="submit" className="bg-neutral-900 hover:bg-neutral-800" disabled={submitting}>{submitting ? 'Saving…' : submitLabel}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// A list that is a table on a computer and stacked cards on a phone, with the
// actions always visible. columns: [{ label, cell: (row) => node, right?, mobile?: 'title'|'sub'|'meta'|'hide' }]
export function ResponsiveList({ rows, columns, actions, empty = 'Nothing yet.', onRowClick, footer }) {
  return (
    <div className="bg-white border rule">
      {/* computer */}
      <table className="hidden md:table w-full text-sm">
        <thead className="bg-neutral-50 border-b rule"><tr>{columns.map((c, i) => <Th key={i} right={c.right}>{c.label}</Th>)}{actions && <Th right>Actions</Th>}</tr></thead>
        <tbody className="divide-y divide-neutral-200">
          {rows.map((r) => (
            <tr key={r.id} className={`hover:bg-neutral-50 ${onRowClick ? 'cursor-pointer' : ''}`} onClick={onRowClick ? () => onRowClick(r) : undefined}>
              {columns.map((c, i) => <td key={i} className={`px-4 py-3 ${c.right ? 'text-right tabular-nums font-fig' : ''} ${i === 0 ? 'font-medium text-neutral-800' : 'text-neutral-600'}`}>{c.cell(r)}</td>)}
              {actions && <td className="px-4 py-2" onClick={(e) => e.stopPropagation()}><div className="flex items-center justify-end gap-1">{actions(r)}</div></td>}
            </tr>
          ))}
        </tbody>
        {footer && rows.length > 0 && <tfoot className="border-t-2 border-neutral-300 bg-neutral-50">{footer}</tfoot>}
      </table>
      {/* phone */}
      <ul className="md:hidden divide-y divide-neutral-200">
        {rows.map((r) => (
          <li key={r.id} className="px-4 py-3" onClick={onRowClick ? () => onRowClick(r) : undefined}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                {columns.filter((c) => c.mobile === 'title' || (!c.mobile && c === columns[0])).map((c, i) => <p key={i} className="text-[14px] font-semibold text-neutral-900 break-words">{c.cell(r)}</p>)}
                <p className="text-[12px] text-neutral-500 mt-0.5 break-words">
                  {columns.filter((c) => c.mobile === 'sub').map((c, i) => <span key={i}>{i > 0 && ' · '}{c.cell(r)}</span>)}
                </p>
              </div>
              <div className="shrink-0 text-right text-[13px] font-fig">{columns.filter((c) => c.mobile === 'meta').map((c, i) => <div key={i}>{c.cell(r)}</div>)}</div>
            </div>
            {actions && <div className="mt-2 flex items-center gap-1 -ml-1.5" onClick={(e) => e.stopPropagation()}>{actions(r, true)}</div>}
          </li>
        ))}
      </ul>
      {rows.length === 0 && <p className="px-4 py-12 text-center text-neutral-400 text-[13px]">{empty}</p>}
    </div>
  );
}

// Small labelled action button (icon on computers, icon + word on phones).
export function Act({ icon: Icon, label, onClick, tone = 'neutral', busy, mobile }) {
  const color = { neutral: 'hover:text-neutral-900', red: 'hover:text-red-600', green: 'hover:text-emerald-700' }[tone];
  return (
    <button type="button" onClick={onClick} disabled={busy} title={label}
      className={`inline-flex items-center gap-1 ${mobile ? 'h-8 px-2 text-[12px] border border-neutral-200' : 'p-1.5'} text-neutral-500 ${color} disabled:opacity-40`}>
      <Icon className="w-3.5 h-3.5" />{mobile && label}
    </button>
  );
}

export const chip = (cls, text) => <span className={`inline-block px-2 py-0.5 rounded text-xs border ${cls}`}>{text}</span>;

// Rent status as people mean it: unpaid and more than 7 days past the due date = overdue.
export function rentStatus(p) {
  const out = Number(p.outstanding) || 0;
  if (p.status === 'paid' || (out <= 0 && (Number(p.total_amount) || 0) > 0)) return 'paid';
  const late = p.due_date && (new Date() - new Date(`${p.due_date}T12:00:00`)) / 86400000 > 7;
  if ((Number(p.amount_paid) || 0) > 0) return late ? 'overdue' : 'part_paid';
  return late ? 'overdue' : 'pending';
}
export const RENT_CHIP = {
  paid: ['text-emerald-700 border-emerald-200 bg-emerald-50', 'paid'],
  part_paid: ['text-amber-700 border-amber-200 bg-amber-50', 'part paid'],
  overdue: ['text-red-700 border-red-200 bg-red-50', 'overdue'],
  pending: ['text-neutral-600 border-neutral-200 bg-neutral-50', 'due'],
};

// Lease dates that need action: lease ends, tenant breaks and rent reviews,
// from units. Past ends on a let unit = holding over (act now).
export const BILLED = {
  monthly: 'Every month (on the 1st)',
  quarterly: 'Every quarter in advance (Jan / Apr / Jul / Oct)',
  quarterly_feb: 'Every quarter in advance (Feb / May / Aug / Nov)',
};
export const isQuarterly = (f) => f === 'quarterly' || f === 'quarterly_feb';
const KIND = { lease_end: 'Lease ends', break_date: 'Tenant break', next_review: 'Rent review' };
export function leaseEvents(units, { months = 18 } = {}) {
  const now = new Date();
  const horizon = new Date(now); horizon.setMonth(horizon.getMonth() + months);
  const out = [];
  for (const u of units) {
    if (!u.tenant_id) continue;
    for (const k of Object.keys(KIND)) {
      if (!u[k]) continue;
      const d = new Date(`${u[k]}T12:00:00`);
      const past = d < now;
      // A past break or review is history; a past lease end on a let unit is holding over.
      if (past && k !== 'lease_end') continue;
      if (d > horizon) continue;
      const days = Math.round((d - now) / 86400000);
      out.push({ id: `${u.id}:${k}`, unit: u, kind: k, label: past ? 'Lease ended — holding over' : KIND[k], date: u[k], days,
        tone: past ? 'red' : days <= 365 ? 'amber' : 'neutral' });
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}
export const EVENT_CHIP = {
  red: 'text-red-700 border-red-200 bg-red-50',
  amber: 'text-amber-700 border-amber-200 bg-amber-50',
  neutral: 'text-neutral-600 border-neutral-200 bg-neutral-50',
};
export const whenText = (days) => {
  if (days < 0) { const m = Math.round(-days / 30.4); return m >= 12 ? `${Math.floor(m / 12)} yr${m >= 24 ? 's' : ''} ago` : m >= 1 ? `${m} mo ago` : `${-days} d ago`; }
  const m = Math.round(days / 30.4); return m >= 1 ? `in ${m} mo` : `in ${days} d`;
};

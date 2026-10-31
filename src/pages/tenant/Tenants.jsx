/* Tenant · Tenants — list (table on a computer, cards on a phone) and a detail
 * panel per tenant: contact, units rented, rent history and balance. */
import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Pencil, Trash2, X, Mail, Phone, Inbox, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { base44, supabase } from '@/api/base44Client';
import TenantShell from './TenantShell';
import { EntityDialog, ResponsiveList, Act, chip, gbp, fmtDate, rentStatus, RENT_CHIP } from './ui';

const FIELDS = [
  { name: 'name', label: 'Name', required: true },
  { name: 'email', label: 'Email', type: 'email', half: true },
  { name: 'phone', label: 'Phone', half: true },
  { name: 'company_registration_number', label: 'Company reg. no.', half: true },
  { name: 'vat_registration_number', label: 'VAT reg. no.', half: true },
  { name: 'status', label: 'Status', type: 'select', options: [
    { value: 'active', label: 'Active' }, { value: 'on_hold', label: 'On hold' }, { value: 'ended', label: 'Ended (left)' },
  ] },
  { name: 'notes', label: 'Notes', type: 'textarea' },
];
const EDITABLE = FIELDS.map((f) => f.name);

const STATUS = {
  active: ['text-emerald-700 border-emerald-200 bg-emerald-50', 'active'],
  on_hold: ['text-amber-700 border-amber-200 bg-amber-50', 'on hold'],
  ended: ['text-neutral-500 border-neutral-200 bg-neutral-50', 'ended'],
};

function Detail({ t, units, payments, onClose, onEdit, found = [], onUse, onNote, onReject }) {
  const mine = units.filter((u) => u.tenant_id === t.id);
  const rent = payments.filter((p) => p.tenant_id === t.id || (!p.tenant_id && p.tenant_name === t.name));
  const owed = rent.filter((p) => rentStatus(p) !== 'paid').reduce((s, p) => s + (Number(p.outstanding) || 0), 0);
  return (
    <div className="fixed inset-0 z-40 flex justify-end" onClick={onClose}>
      <div className="absolute inset-0 bg-black/20" />
      <aside className="relative w-full max-w-lg h-full bg-background border-l rule overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="px-5 h-14 flex items-center justify-between border-b rule bg-white sticky top-0">
          <p className="font-semibold truncate">{t.name}</p>
          <div className="flex items-center gap-1">
            <Button variant="outline" size="sm" className="gap-1.5 border-neutral-300" onClick={onEdit}><Pencil className="w-3.5 h-3.5" /> Edit</Button>
            <button onClick={onClose} className="p-2 text-neutral-400 hover:text-neutral-900" title="Close"><X className="w-4 h-4" /></button>
          </div>
        </div>
        <div className="p-5 space-y-6 text-[13px]">
          <div className="space-y-1.5">
            {chip(...(STATUS[t.status] || STATUS.active))}
            {t.email && <p className="flex items-center gap-2"><Mail className="w-3.5 h-3.5 text-neutral-400" /><a className="underline" href={`mailto:${t.email}`}>{t.email}</a></p>}
            {t.phone && <p className="flex items-center gap-2"><Phone className="w-3.5 h-3.5 text-neutral-400" /><a className="underline" href={`tel:${t.phone}`}>{t.phone}</a></p>}
            {!t.email && !t.phone && <p className="text-amber-700">No email or phone yet — add them with Edit.</p>}
            {(t.company_registration_number || t.vat_registration_number) && <p className="text-neutral-500 font-fig">{t.company_registration_number && `Company ${t.company_registration_number}`}{t.company_registration_number && t.vat_registration_number && ' · '}{t.vat_registration_number && `VAT ${t.vat_registration_number}`}</p>}
            {t.notes && <p className="text-neutral-600 whitespace-pre-wrap">{t.notes}</p>}
          </div>

          {found.length > 0 && (
            <div>
              <p className="text-[11px] uppercase tracking-[0.1em] text-neutral-400 mb-2 flex items-center gap-1.5"><Inbox className="w-3.5 h-3.5" /> Found in the office@ mailbox · check before using</p>
              <ul className="bg-white border rule divide-y divide-neutral-100">
                {found.map((c) => (
                  <li key={c.id} className="px-3 py-2.5">
                    <p className="font-medium text-neutral-800 break-all">{c.name ? `${c.name} · ` : ''}{c.email}</p>
                    <p className="text-[12px] text-neutral-500 font-fig">{c.phones?.length ? `${c.phones.join(' · ')} · ` : ''}{c.mails} mail{c.mails === 1 ? '' : 's'}, last {fmtDate(c.last_seen)}</p>
                    {c.subjects?.[0] && <p className="text-[11px] text-neutral-400 truncate">“{c.subjects[0]}”</p>}
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      <button onClick={() => onUse(c)} className="h-7 px-2.5 inline-flex items-center gap-1 text-[12px] bg-neutral-900 text-white hover:bg-neutral-800"><Check className="w-3.5 h-3.5" /> Main contact</button>
                      <button onClick={() => onNote(c)} className="h-7 px-2.5 text-[12px] border border-neutral-300 text-neutral-600 hover:text-neutral-900">Add to notes</button>
                      <button onClick={() => onReject(c)} className="h-7 px-2.5 text-[12px] border border-neutral-300 text-neutral-500 hover:text-neutral-900">Not them</button>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div>
            <p className="text-[11px] uppercase tracking-[0.1em] text-neutral-400 mb-2">Units</p>
            <ul className="bg-white border rule divide-y divide-neutral-100">
              {mine.map((u) => <li key={u.id} className="px-3 py-2 flex justify-between gap-3"><span>{u.reference} <span className="text-neutral-400">· {u.address}</span></span><span className="font-fig shrink-0">{gbp(u.rent_amount)}/mo</span></li>)}
              {mine.length === 0 && <li className="px-3 py-2 text-neutral-400">No unit linked — set the tenant on a unit in Units.</li>}
            </ul>
          </div>

          <div>
            <div className="flex items-baseline justify-between mb-2">
              <p className="text-[11px] uppercase tracking-[0.1em] text-neutral-400">Rent</p>
              <p className={`font-fig ${owed > 0 ? 'text-red-700' : 'text-neutral-500'}`}>{owed > 0 ? `${gbp(owed)} owed` : 'nothing owed'}</p>
            </div>
            <ul className="bg-white border rule divide-y divide-neutral-100">
              {rent.slice(0, 12).map((p) => { const s = rentStatus(p); return (
                <li key={p.id} className="px-3 py-2 flex items-center justify-between gap-3">
                  <span className="min-w-0">{fmtDate(p.period_start || p.due_date)}{p.notes ? <span className="text-neutral-400"> · {p.notes}</span> : ''}</span>
                  <span className="flex items-center gap-2 shrink-0"><span className="font-fig">{gbp(p.total_amount)}</span>{chip(...RENT_CHIP[s])}</span>
                </li>
              ); })}
              {rent.length === 0 && <li className="px-3 py-2 text-neutral-400">No rent recorded.</li>}
            </ul>
            <Link to={`/tenant/rent?tenant=${t.id}`} className="inline-block mt-2 underline text-neutral-600 hover:text-neutral-900">All rent for {t.name}</Link>
          </div>
        </div>
      </aside>
    </div>
  );
}

export default function Tenants() {
  const qc = useQueryClient();
  const { data: tenants = [] } = useQuery({ queryKey: ['tenants'], queryFn: () => base44.entities.Tenant.list('name') });
  const { data: units = [] } = useQuery({ queryKey: ['units'], queryFn: () => base44.entities.Unit.list('reference') });
  const { data: payments = [] } = useQuery({ queryKey: ['rent_payments'], queryFn: () => base44.entities.RentPayment.list('-due_date') });
  const [dialog, setDialog] = useState(null); // null | 'new' | tenant
  const [open, setOpen] = useState(null);     // tenant shown in the detail panel
  const [showEnded, setShowEnded] = useState(false);
  // Contacts found by reading the office@ mailbox (nothing is sent): to accept or reject here.
  const sugQ = useQuery({ queryKey: ['contact_suggestions'], queryFn: async () => { const { data, error } = await supabase.from('contact_suggestions').select('*').eq('status', 'new').order('mails', { ascending: false }); if (error) throw error; return data; } });
  const found = (tid) => (sugQ.data || []).filter((c) => c.tenant_id === tid);
  const decide = useMutation({
    mutationFn: async ({ c, how }) => {
      const t = tenants.find((x) => x.id === c.tenant_id);
      const line = `${c.name ? `${c.name} ` : ''}<${c.email}>${c.phones?.length ? ` ${c.phones.join(' / ')}` : ''}`;
      if (how === 'use' && t) {
        const old = t.email && t.email !== c.email ? `${t.email}${t.phone ? ` ${t.phone}` : ''}` : null;
        await base44.entities.Tenant.update(t.id, { email: c.email, phone: t.phone || c.phones?.[0] || null,
          notes: old ? `${t.notes ? `${t.notes}\n` : ''}Also: ${old}` : t.notes, updated_date: new Date().toISOString() });
      }
      if (how === 'note' && t) await base44.entities.Tenant.update(t.id, { notes: `${t.notes ? `${t.notes}\n` : ''}Contact: ${line}`, updated_date: new Date().toISOString() });
      const { error } = await supabase.from('contact_suggestions').update({ status: how === 'reject' ? 'rejected' : 'accepted' }).eq('id', c.id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['contact_suggestions'] }); qc.invalidateQueries({ queryKey: ['tenants'] }); },
  });

  const save = useMutation({
    mutationFn: async (v) => {
      const data = Object.fromEntries(EDITABLE.map((k) => [k, typeof v[k] === 'string' ? v[k].trim() || null : v[k] ?? null]));
      if (!data.name) throw new Error('A name is needed.');
      const row = v.id ? await base44.entities.Tenant.update(v.id, { ...data, updated_date: new Date().toISOString() }) : await base44.entities.Tenant.create({ ...data, status: data.status || 'active' });
      // Keep the name shown on units and rent in step with a rename.
      if (v.id && dialog?.name && data.name !== dialog.name) {
        await Promise.all(units.filter((u) => u.tenant_id === v.id).map((u) => base44.entities.Unit.update(u.id, { tenant_name: data.name })));
      }
      return row;
    },
    onSuccess: (row) => { qc.invalidateQueries({ queryKey: ['tenants'] }); qc.invalidateQueries({ queryKey: ['units'] }); setDialog(null); if (open && row?.id === open.id) setOpen(row); },
  });
  const del = useMutation({
    mutationFn: (t) => base44.entities.Tenant.delete(t.id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tenants'] }),
    onError: (e) => alert(`Could not delete: ${e.message}`),
  });
  const remove = (t) => {
    const linked = units.filter((u) => u.tenant_id === t.id).length;
    if (linked) return alert(`${t.name} still rents ${linked} unit${linked > 1 ? 's' : ''}. Set those units to another tenant (or vacant) first, or mark the tenant as "Ended" instead.`);
    if (confirm(`Delete tenant "${t.name}"? Their rent history stays.`)) del.mutate(t);
  };

  const info = useMemo(() => Object.fromEntries(tenants.map((t) => {
    const mine = units.filter((u) => u.tenant_id === t.id);
    const owed = payments.filter((p) => (p.tenant_id === t.id || (!p.tenant_id && p.tenant_name === t.name)) && rentStatus(p) !== 'paid').reduce((s, p) => s + (Number(p.outstanding) || 0), 0);
    return [t.id, { units: mine, rent: mine.reduce((s, u) => s + (Number(u.rent_amount) || 0), 0), owed }];
  })), [tenants, units, payments]);

  const shown = tenants.filter((t) => showEnded || t.status !== 'ended');
  const ended = tenants.length - tenants.filter((t) => t.status !== 'ended').length;
  const actions = <Button className="gap-2 bg-neutral-900 hover:bg-neutral-800" onClick={() => { save.reset(); setDialog('new'); }}><Plus className="w-4 h-4" /> New tenant</Button>;

  return (
    <TenantShell title="Tenants" subtitle={`${tenants.length - ended} current${ended ? ` · ${ended} ended` : ''}`} actions={actions}>
      {ended > 0 && <label className="mb-3 inline-flex items-center gap-2 text-[12px] text-neutral-600"><input type="checkbox" checked={showEnded} onChange={(e) => setShowEnded(e.target.checked)} className="accent-neutral-900" /> Show tenants who have left</label>}
      {(sugQ.data || []).length > 0 && (
        <p className="mb-3 px-4 py-2.5 bg-sky-50 border border-sky-200 text-[13px] text-sky-900">
          Contact details for {new Set(sugQ.data.map((c) => c.tenant_id)).size} tenants were found in the office@ mailbox. Click a tenant marked <b>found</b> to check and keep the right ones. Nothing has been sent to them.
        </p>
      )}
      <ResponsiveList
        rows={shown}
        onRowClick={(t) => setOpen(t)}
        empty="No tenants yet."
        columns={[
          { label: 'Name', cell: (t) => t.name, mobile: 'title' },
          { label: 'Units', cell: (t) => info[t.id]?.units.map((u) => u.reference).join(', ') || '—', mobile: 'sub' },
          { label: 'Contact', cell: (t) => <>{t.email || t.phone || <span className="text-amber-700">none</span>}{found(t.id).length > 0 && <span className="ml-1.5 inline-block px-1.5 py-0.5 text-[10px] border border-sky-200 bg-sky-50 text-sky-700 rounded whitespace-nowrap">{found(t.id).length} found</span>}</>, mobile: 'sub' },
          { label: 'Rent / month', right: true, cell: (t) => (info[t.id]?.rent ? gbp(info[t.id].rent) : '—'), mobile: 'meta' },
          { label: 'Owed', right: true, cell: (t) => (info[t.id]?.owed > 0 ? <span className="text-red-700">{gbp(info[t.id].owed)}</span> : '—'), mobile: 'meta' },
          { label: 'Status', cell: (t) => chip(...(STATUS[t.status] || STATUS.active)), mobile: 'hide' },
        ]}
        actions={(t, m) => <>
          <Act icon={Pencil} label="Edit" mobile={m} onClick={() => { save.reset(); setDialog(t); }} />
          <Act icon={Trash2} label="Delete" tone="red" mobile={m} onClick={() => remove(t)} />
        </>}
      />
      <p className="mt-2 text-[12px] text-neutral-400">Click a tenant to see their units, rent and balance.</p>

      {open && <Detail t={tenants.find((x) => x.id === open.id) || open} units={units} payments={payments} found={found(open.id)}
        onUse={(c) => decide.mutate({ c, how: 'use' })} onNote={(c) => decide.mutate({ c, how: 'note' })} onReject={(c) => decide.mutate({ c, how: 'reject' })} onClose={() => setOpen(null)} onEdit={() => { save.reset(); setDialog(tenants.find((x) => x.id === open.id) || open); }} />}

      <EntityDialog
        open={dialog !== null}
        onClose={() => setDialog(null)}
        title={dialog === 'new' ? 'New tenant' : `Edit ${dialog?.name || 'tenant'}`}
        fields={FIELDS}
        initial={dialog === 'new' ? { status: 'active' } : dialog}
        onSubmit={(v) => save.mutate(v)}
        submitting={save.isPending}
        error={save.error}
      />
    </TenantShell>
  );
}

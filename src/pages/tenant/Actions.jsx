/* Tenant · Actions — one list of everything that needs doing across the
 * properties: leases ended or ending, tenant breaks, rent reviews, unpaid rent,
 * empty units, service charge paid by PB Abbey. The list is rebuilt from the
 * data each time the page opens (refresh_actions in the database); problems
 * that are fixed close by themselves. Nothing is sent from here. */
import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Check, Clock, X, Plus, ArrowUpRight, RotateCcw, FileText, ClipboardList } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { base44, supabase } from '@/api/base44Client';
import TenantShell from './TenantShell';
import { Tile, TileGrid, Meter, Split, Ranked, TONE, gbpK } from './viz';
import { EntityDialog, fmtDate } from './ui';
import { docFor } from './Prepare';

const SEV = { red: 0, amber: 1, neutral: 2 };
const STRIPE = { red: 'border-l-red-600', amber: 'border-l-amber-500', neutral: 'border-l-neutral-300' };
const DOT = { red: 'bg-red-600', amber: 'bg-amber-500', neutral: 'bg-neutral-300' };
const KIND = {
  holding_over: 'Lease ended', lease_end: 'Lease ending', break: 'Tenant break', review: 'Rent review', arrears: 'Unpaid rent',
  vacant: 'Empty unit', sc_included: 'Service charge', no_contact: 'Contacts', no_rent: 'Rent not set', manual: 'To check', enquiry: 'Enquiry', bank_match: 'Payment received', mail: 'Mail to answer',
};
const gbp0 = (n) => `£${Math.round(Number(n) || 0).toLocaleString('en-GB')}`;
const PREP = { renewal: 'Prepare letter', review: 'Calculate + letter', arrears: 'Reminder letter' };
const inDays = (d) => { const t = new Date(); t.setDate(t.getDate() + d); return t.toISOString().slice(0, 10); };

function money(a) {
  if (!(Number(a.amount) > 0)) return null;
  if (a.amount_kind === 'owed') return <span className="text-red-700">{gbp0(a.amount)} owed</span>;
  if (a.data?.at_risk) return <span className="text-neutral-600">{gbp0(a.amount)} a year at risk</span>;
  if (a.kind === 'vacant') return <span className="text-amber-700">{gbp0(a.amount)} a year lost while empty</span>;
  return <span className="text-emerald-700">+{gbp0(a.amount)} a year</span>;
}

export default function Actions() {
  const qc = useQueryClient();
  const [tab, setTab] = useState('open');
  const [adding, setAdding] = useState(false);
  // Monday summary email to Peter + Leo (internal only), switched on here.
  const weekly = useQuery({ queryKey: ['app_settings', 'weekly_summary'], queryFn: async () => { const { data } = await supabase.from('app_settings').select('value').eq('id', 'weekly_summary').maybeSingle(); return data?.value || {}; } });
  const setWeekly = useMutation({
    mutationFn: async (patch) => { const { error } = await supabase.from('app_settings').upsert({ id: 'weekly_summary', value: { ...(weekly.data || {}), ...patch } }); if (error) throw error; },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['app_settings', 'weekly_summary'] }),
  });
  const [testSent, setTestSent] = useState(false);
  const sendTest = async () => { const me = await base44.auth.me().catch(() => null); if (!me?.email) return; await setWeekly.mutateAsync({ test_to: me.email }); setTestSent(true); };

  // Rebuild the list from the data, then read it.
  const q = useQuery({
    queryKey: ['actions'],
    queryFn: async () => {
      const { error } = await supabase.rpc('refresh_actions');
      if (error) throw error;
      return base44.entities.Action.list('-updated_date', 2000);
    },
  });
  const { data: units = [] } = useQuery({ queryKey: ['units'], queryFn: () => base44.entities.Unit.list('reference') });
  const all = q.data || [];

  const set = useMutation({
    mutationFn: ({ a, status, snoozed_until = null }) => base44.entities.Action.update(a.id, {
      status, snoozed_until, updated_date: new Date().toISOString(),
      resolved_date: ['done', 'dismissed'].includes(status) ? new Date().toISOString() : null,
    }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['actions'] }),
  });
  const add = useMutation({
    mutationFn: (v) => {
      const u = units.find((x) => x.id === v.unit_id);
      return base44.entities.Action.create({
        key: `manual:${Date.now()}`, kind: 'manual', severity: v.severity || 'amber', title: v.title, detail: v.detail || null,
        due_date: v.due_date || null, unit_id: u?.id || null, tenant_id: u?.tenant_id || null, data: u ? { site: u.site } : {},
      });
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['actions'] }); setAdding(false); },
  });

  const open = useMemo(() => all.filter((a) => a.status === 'open')
    .sort((a, b) => SEV[a.severity] - SEV[b.severity] || (Number(b.amount) || 0) - (Number(a.amount) || 0)), [all]);
  const rows = tab === 'open' ? open
    : tab === 'snoozed' ? all.filter((a) => a.status === 'snoozed')
    : all.filter((a) => ['done', 'dismissed', 'resolved'].includes(a.status));

  const sum = (list, f) => list.filter(f).reduce((s, a) => s + (Number(a.amount) || 0), 0);
  const gain = sum(open, (a) => a.amount_kind === 'year' && !a.data?.at_risk);
  const risk = sum(open, (a) => a.amount_kind === 'year' && a.data?.at_risk);
  const owed = sum(open, (a) => a.amount_kind === 'owed');
  const dealt = sum(all.filter((a) => a.status === 'done'), (a) => a.amount_kind === 'year' && !a.data?.at_risk);

  const tabBtn = (k, label, n) => (
    <button key={k} onClick={() => setTab(k)} className={`h-8 px-3 text-[12px] border ${tab === k ? 'bg-neutral-900 text-white border-neutral-900' : 'bg-white border-neutral-300 text-neutral-600'}`}>
      {label}{n != null && <span className="ml-1.5 font-fig opacity-70">{n}</span>}
    </button>
  );

  return (
    <TenantShell title="Actions" subtitle="What needs doing across the properties, most urgent and most valuable first. Nothing is sent from here."
      actions={<Button className="gap-2 bg-neutral-900 hover:bg-neutral-800" onClick={() => { add.reset(); setAdding(true); }}><Plus className="w-4 h-4" /> Add a task</Button>}>
      <div className="mb-6">
        <TileGrid>
          <Tile label="To do" value={open.length} sub={`${open.filter((a) => a.severity === 'red').length} urgent`} tone={open.some((a) => a.severity === 'red') ? 'red' : 'green'}>
            <Split parts={[{ label: 'Urgent', value: open.filter((a) => a.severity === 'red').length, color: TONE.red }, { label: 'Soon', value: open.filter((a) => a.severity === 'amber').length, color: TONE.amber }, { label: 'Later', value: open.filter((a) => a.severity === 'neutral').length, color: TONE.soft }]} format={(n) => n} />
          </Tile>
          <Tile label="Rent to gain" value={gbpK(gain)} sub="a year, estimated" tone="green">
            <Ranked rows={Object.entries(open.filter((a) => a.amount_kind === 'year' && !a.data?.at_risk).reduce((m, a) => { const k2 = KIND[a.kind] || a.kind; m[k2] = (m[k2] || 0) + Number(a.amount || 0); return m; }, {})).sort((x, y) => y[1] - x[1]).slice(0, 4).map(([label, value]) => ({ label, value }))} color={TONE.green} />
          </Tile>
          <Tile label="Unpaid" value={gbpK(owed)} sub="rent and charges" tone={owed > 0 ? 'red' : 'green'}>
            <Ranked rows={open.filter((a) => a.amount_kind === 'owed').sort((x, y) => y.amount - x.amount).slice(0, 4).map((a) => ({ label: a.title.split(':')[0].replace(/ (Ltd|Limited|LLP|UK Ltd|NHS Foundation Trust)$/i, ''), value: Number(a.amount) }))} color={TONE.red} />
          </Tile>
          <Tile label="Dealt with" value={gbpK(dealt)} sub="a year, tasks marked done" tone={dealt > 0 ? 'green' : undefined}>
            <Meter value={dealt} max={Math.max(gain + dealt, 1)} tone="green" left="done" right={`of ${gbpK(gain + dealt)} found`} />
          </Tile>
        </TileGrid>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-neutral-600">
        <span>Monday summary email to {(weekly.data?.to || []).join(' and ') || 'Peter and Leo'}:</span>
        <button onClick={() => setWeekly.mutate({ enabled: !weekly.data?.enabled })} className={`h-7 px-2.5 border ${weekly.data?.enabled ? 'bg-emerald-50 border-emerald-300 text-emerald-800' : 'bg-white border-neutral-300'}`}>{weekly.data?.enabled ? 'On · switch off' : 'Off · switch on'}</button>
        <button onClick={sendTest} disabled={testSent} className="underline disabled:no-underline disabled:text-emerald-700">{testSent ? 'Test on its way to you' : 'Send a test to me'}</button>
      </div>
      <div className="mb-3 flex flex-wrap gap-2">
        {tabBtn('open', 'To do', open.length)}
        {tabBtn('snoozed', 'Later', all.filter((a) => a.status === 'snoozed').length)}
        {tabBtn('closed', 'Done')}
      </div>

      {q.isLoading && <p className="py-10 text-center text-[13px] text-neutral-400">Checking leases, rent and units…</p>}
      {q.isError && <p className="py-3 px-4 text-[13px] text-red-700 bg-red-50 border border-red-200">Could not load the actions: {String(q.error?.message || q.error)}</p>}

      <ul className="flex flex-col gap-2">
        {rows.map((a) => (
          <li key={a.id} className={`bg-white border rule border-l-4 ${STRIPE[a.severity] || STRIPE.neutral} px-4 py-3`}>
            <div className="flex flex-col md:flex-row md:items-start gap-2 md:gap-6">
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-2 text-[11px] uppercase tracking-[0.08em] text-neutral-400">
                  <span className={`w-1.5 h-1.5 rounded-full ${DOT[a.severity] || DOT.neutral}`} />
                  {KIND[a.kind] || a.kind}{a.data?.site && <span className="normal-case tracking-normal">· {a.data.site}</span>}
                </p>
                <p className="mt-1 text-[14px] font-medium text-neutral-900 break-words">{a.title}</p>
                {a.detail && a.kind !== 'mail' && <p className="mt-0.5 text-[13px] text-neutral-600 break-words">{a.detail}</p>}
                {a.kind === 'mail' && <p className="mt-0.5 text-[12px] text-neutral-500 break-words">“{a.data?.subject}” · {a.data?.from}</p>}
                {a.kind === 'mail' && a.data?.draft && (
                  <details className="mt-1.5 text-[13px]">
                    <summary className="cursor-pointer text-neutral-600 underline">Draft reply prepared (on the home server)</summary>
                    <p className="mt-1.5 p-3 bg-neutral-50 border rule whitespace-pre-line text-neutral-800">{a.data.draft}</p>
                    <p className="mt-1 text-[11px] text-neutral-400">Written by the assistant from the mail and our records. Check every fact before sending.</p>
                  </details>
                )}
                {(a.data?.sent || []).length > 0 && <p className="mt-1 text-[12px] text-emerald-700">Letter sent to {a.data.sent[a.data.sent.length - 1].to} on {fmtDate(a.data.sent[a.data.sent.length - 1].at)}</p>}
                <p className="mt-1.5 text-[12px] font-fig flex flex-wrap gap-x-3 gap-y-1">
                  {money(a)}
                  {a.due_date && <span className="text-neutral-400">{a.kind === 'holding_over' ? 'ended' : 'date'} {fmtDate(a.due_date)}</span>}
                  {a.data?.draft && <span className="text-neutral-500">draft saved</span>}
                  {a.status === 'snoozed' && <span className="text-neutral-400">back on {fmtDate(a.snoozed_until)}</span>}
                  {a.status === 'resolved' && <span className="text-emerald-700">closed by itself (no longer a problem)</span>}
                  {a.status === 'done' && <span className="text-emerald-700">done {fmtDate(a.resolved_date)}</span>}
                  {a.status === 'dismissed' && <span className="text-neutral-400">not relevant</span>}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                {a.status === 'open' && docFor(a) && <Link to={`/tenant/prepare/${a.id}`} className="h-8 px-2.5 inline-flex items-center gap-1 text-[12px] border border-neutral-900 text-neutral-900 hover:bg-neutral-50"><FileText className="w-3.5 h-3.5" /> {PREP[docFor(a)]}</Link>}
                {a.status === 'open' && ['holding_over', 'lease_end', 'break'].includes(a.kind) && <Link to={`/tenant/prepare/${a.id}?doc=pack`} className="h-8 px-2.5 inline-flex items-center gap-1 text-[12px] border border-neutral-300 text-neutral-600 hover:text-neutral-900"><ClipboardList className="w-3.5 h-3.5" /> Pack</Link>}
                {a.unit_id && <Link to={`/tenant/units?unit=${a.unit_id}`} className="h-8 px-2.5 inline-flex items-center gap-1 text-[12px] border border-neutral-300 text-neutral-600 hover:text-neutral-900"><ArrowUpRight className="w-3.5 h-3.5" /> Unit</Link>}
                {a.status === 'open' && a.kind === 'mail' && <Link to={`/mail?account=office&new=1&to=${encodeURIComponent(a.data?.from || '')}&subject=${encodeURIComponent(/^re:/i.test(a.data?.subject || '') ? a.data.subject : `Re: ${a.data?.subject || ''}`)}${a.data?.draft ? `&body=${encodeURIComponent(a.data.draft)}` : ''}`} className="h-8 px-2.5 inline-flex items-center gap-1 text-[12px] border border-neutral-900 text-neutral-900 hover:bg-neutral-50"><ArrowUpRight className="w-3.5 h-3.5" /> {a.data?.draft ? 'Reply with this draft' : 'Reply'}</Link>}
                {a.status === 'open' && a.kind === 'bank_match' && <Link to="/tenant/bank" className="h-8 px-2.5 inline-flex items-center gap-1 text-[12px] border border-neutral-900 text-neutral-900 hover:bg-neutral-50"><ArrowUpRight className="w-3.5 h-3.5" /> Confirm in Bank</Link>}
                {a.status === 'open' && (a.kind === 'vacant' || a.kind === 'enquiry') && <Link to="/tenant/to-let" className="h-8 px-2.5 inline-flex items-center gap-1 text-[12px] border border-neutral-900 text-neutral-900 hover:bg-neutral-50"><ArrowUpRight className="w-3.5 h-3.5" /> {a.kind === 'enquiry' ? 'Enquiries' : 'Listing'}</Link>}
                {a.kind === 'no_contact' && <Link to="/tenant/tenants" className="h-8 px-2.5 inline-flex items-center gap-1 text-[12px] border border-neutral-300 text-neutral-600 hover:text-neutral-900"><ArrowUpRight className="w-3.5 h-3.5" /> Tenants</Link>}
                {a.kind === 'arrears' && <Link to={`/tenant/rent${a.tenant_id ? `?tenant=${a.tenant_id}` : ''}`} className="h-8 px-2.5 inline-flex items-center gap-1 text-[12px] border border-neutral-300 text-neutral-600 hover:text-neutral-900"><ArrowUpRight className="w-3.5 h-3.5" /> Rent</Link>}
                {a.status === 'open' && <>
                  <button onClick={() => set.mutate({ a, status: 'snoozed', snoozed_until: inDays(30) })} className="h-8 px-2.5 inline-flex items-center gap-1 text-[12px] border border-neutral-300 text-neutral-600 hover:text-neutral-900" title="Hide for 30 days"><Clock className="w-3.5 h-3.5" /> Later</button>
                  <button onClick={() => set.mutate({ a, status: 'dismissed' })} className="h-8 px-2.5 inline-flex items-center gap-1 text-[12px] border border-neutral-300 text-neutral-500 hover:text-neutral-900" title="Not relevant"><X className="w-3.5 h-3.5" /> Not relevant</button>
                  <button onClick={() => set.mutate({ a, status: 'done' })} className="h-8 px-2.5 inline-flex items-center gap-1 text-[12px] bg-neutral-900 text-white hover:bg-neutral-800"><Check className="w-3.5 h-3.5" /> Done</button>
                </>}
                {a.status !== 'open' && a.status !== 'resolved' && <button onClick={() => set.mutate({ a, status: 'open' })} className="h-8 px-2.5 inline-flex items-center gap-1 text-[12px] border border-neutral-300 text-neutral-600 hover:text-neutral-900"><RotateCcw className="w-3.5 h-3.5" /> Back to do</button>}
              </div>
            </div>
          </li>
        ))}
      </ul>
      {!q.isLoading && rows.length === 0 && <p className="py-12 text-center text-[13px] text-neutral-400 bg-white border rule">{tab === 'open' ? 'Nothing to do. Every lease, rent and unit is in order.' : 'Nothing here.'}</p>}

      <EntityDialog open={adding} onClose={() => setAdding(false)} title="Add a task" submitLabel="Add"
        fields={[
          { name: 'title', label: 'What needs doing', required: true },
          { name: 'detail', label: 'Details', type: 'textarea' },
          { name: 'unit_id', label: 'Unit', type: 'select', options: [{ value: '', label: '— none —' }, ...units.map((u) => ({ value: u.id, label: `${u.reference}${u.tenant_name ? ` — ${u.tenant_name}` : ''}` }))] },
          { name: 'severity', label: 'Priority', type: 'select', half: true, options: [{ value: 'red', label: 'Urgent' }, { value: 'amber', label: 'Soon' }, { value: 'neutral', label: 'When possible' }] },
          { name: 'due_date', label: 'By', type: 'date', half: true },
        ]}
        initial={{ severity: 'amber', unit_id: '' }}
        onSubmit={(v) => add.mutate(v)} submitting={add.isPending} error={add.error} />
    </TenantShell>
  );
}

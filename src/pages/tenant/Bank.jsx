/* Tenant · Bank — PB Abbey's bank accounts read through Open Banking (Enable
 * Banking): balances, money in, and which rent each payment pays. Clear matches
 * are applied by the server on its own (tenant named + exact amount); the others
 * wait here for a click. Read-only access: nothing can be paid from here.
 * Peter approves the access himself at his bank; it lasts 180 days. */
import React, { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Check, X, RefreshCw, ExternalLink, Landmark, Copy } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { base44, supabase } from '@/api/base44Client';
import TenantShell from './TenantShell';
import { fmtDate } from './ui';

const gbp = (n) => `£${(Number(n) || 0).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const setting = async (id) => { const { data } = await supabase.from('app_settings').select('value').eq('id', id).maybeSingle(); return data?.value || null; };
const saveSetting = async (id, value) => { const { error } = await supabase.from('app_settings').upsert({ id, value }); if (error) throw error; };
const STATUS = {
  matched: ['text-emerald-700 border-emerald-200 bg-emerald-50', 'matched'],
  suggested: ['text-amber-700 border-amber-200 bg-amber-50', 'to confirm'],
  unmatched: ['text-neutral-600 border-neutral-200 bg-neutral-50', 'not matched'],
  ignored: ['text-neutral-400 border-neutral-200 bg-white', 'not rent'],
};

function Setup({ cfg, onSaved }) {
  const [appId, setAppId] = useState(cfg?.app_id || '');
  const certQ = useQuery({ queryKey: ['bank_cert'], queryFn: () => setting('bank_cert') });
  const [copied, setCopied] = useState('');
  const copy = async (k, t) => { try { await navigator.clipboard.writeText(t); setCopied(k); setTimeout(() => setCopied(''), 1500); } catch { /* ignore */ } };
  const redirect = 'https://pbabbey.com/tenant/bank'; // must match the server (bank.js REDIRECT)
  return (
    <div className="bg-white border rule p-5 flex flex-col gap-4 max-w-3xl">
      <p className="text-[14px]">Connect PB Abbey's bank accounts once, and payments are matched to the rent by themselves. Access is <b>read-only</b>: balances and transactions, never payments.</p>
      <ol className="list-decimal pl-5 flex flex-col gap-3 text-[13px] text-neutral-700">
        <li>Create a free account at <a className="underline" href="https://enablebanking.com/cp" target="_blank" rel="noreferrer">enablebanking.com</a>, then <b>Applications → Add a new application</b>, environment <b>Production</b>.</li>
        <li>Redirect URL: <span className="font-fig select-all bg-neutral-100 px-1">{redirect}</span> <button className="underline text-neutral-500" onClick={() => copy('url', redirect)}>{copied === 'url' ? 'copied' : 'copy'}</button></li>
        <li>Certificate: upload this one (public part only, the secret key stays on PB Abbey's server).
          <pre className="mt-1 p-2 bg-neutral-50 border rule text-[10px] leading-tight overflow-x-auto max-h-28">{certQ.data?.pem || '…'}</pre>
          <button className="mt-1 inline-flex items-center gap-1 underline text-neutral-500" onClick={() => copy('cert', certQ.data?.pem || '')}><Copy className="w-3 h-3" />{copied === 'cert' ? 'copied' : 'copy the certificate'}</button></li>
        <li>In Enable Banking, <b>link PB Abbey's accounts</b> to the application (Peter logs in to his bank there). Without this, the bank returns no account.</li>
        <li>Paste the <b>Application ID</b> here:
          <div className="mt-1 flex gap-2"><input id="bank-app-id" value={appId} onChange={(e) => setAppId(e.target.value.trim())} placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" className="h-9 flex-1 min-w-0 px-2.5 border border-neutral-300 bg-white text-[13px] font-fig rounded-md" />
            <Button className="bg-neutral-900 hover:bg-neutral-800" disabled={!appId} onClick={async () => { await saveSetting('bank', { ...(cfg || {}), app_id: appId, psu_type: cfg?.psu_type || 'business', country: 'GB' }); onSaved(); }}>Save</Button></div></li>
      </ol>
    </div>
  );
}

export default function Bank() {
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const [tab, setTab] = useState('suggested');
  const [pick, setPick] = useState(null);
  const cfgQ = useQuery({ queryKey: ['bank_cfg'], queryFn: () => setting('bank') });
  const listQ = useQuery({ queryKey: ['bank_list'], queryFn: () => setting('bank_list'), refetchInterval: (q) => (q.state.data?.banks ? false : 5000) });
  const linksQ = useQuery({ queryKey: ['bank_links'], queryFn: async () => { const { data, error } = await supabase.from('bank_links').select('*').order('created_date', { ascending: false }); if (error) throw error; return data; },
    refetchInterval: (q) => ((q.state.data || []).some((l) => ['requested', 'code_received'].includes(l.status)) ? 3000 : false) });
  const accQ = useQuery({ queryKey: ['bank_accounts'], queryFn: async () => { const { data, error } = await supabase.from('bank_accounts').select('*').eq('active', true); if (error) throw error; return data; } });
  const txQ = useQuery({ queryKey: ['bank_tx'], queryFn: async () => { const { data, error } = await supabase.from('bank_transactions').select('id,account_id,booking_date,amount,counterparty,remittance,match_status,rent_payment_id,matched_by').order('booking_date', { ascending: false }).limit(1000); if (error) throw error; return data; } });
  const { data: payments = [] } = useQuery({ queryKey: ['rent_payments'], queryFn: () => base44.entities.RentPayment.list('-due_date', 5000) });
  const cfg = cfgQ.data;
  const refresh = () => ['bank_links', 'bank_accounts', 'bank_tx', 'rent_payments', 'actions'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));

  // Back from the bank: hand the code to the server.
  useEffect(() => {
    const code = params.get('code'); const state = params.get('state');
    if (!code || !state) return;
    supabase.from('bank_links').update({ code, status: 'code_received', updated_date: new Date().toISOString() }).eq('state', state).eq('status', 'awaiting_user')
      .then(() => { setParams({}, { replace: true }); refresh(); });
  }, [params]); // eslint-disable-line react-hooks/exhaustive-deps

  const connect = useMutation({
    mutationFn: async (aspsp) => {
      const state = `pba-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      const { error } = await supabase.from('bank_links').insert({ aspsp_name: aspsp, country: 'GB', state });
      if (error) throw error;
    },
    onSuccess: refresh,
  });
  const confirm = useMutation({ mutationFn: async ({ tx, rent }) => { const { error } = await supabase.rpc('confirm_bank_match', { p_tx: tx, p_rent: rent }); if (error) throw error; }, onSuccess: () => { setPick(null); refresh(); } });
  const ignore = useMutation({ mutationFn: async (tx) => { const { error } = await supabase.from('bank_transactions').update({ match_status: 'ignored', rent_payment_id: null }).eq('id', tx); if (error) throw error; }, onSuccess: refresh });
  const syncNow = useMutation({ mutationFn: () => saveSetting('bank_request', { sync: true }) });
  const askBanks = useMutation({ mutationFn: () => saveSetting('bank_request', { banks: true }), onSuccess: () => qc.invalidateQueries({ queryKey: ['bank_list'] }) });

  const byId = useMemo(() => Object.fromEntries(payments.map((p) => [p.id, p])), [payments]);
  const open = payments.filter((p) => Number(p.outstanding) > 0.005 && p.status !== 'paid');
  const credits = (txQ.data || []).filter((t) => t.amount > 0);
  const rows = tab === 'all' ? (txQ.data || []) : credits.filter((t) => (tab === 'suggested' ? t.match_status === 'suggested' : tab === 'unmatched' ? t.match_status === 'unmatched' : t.match_status === 'matched'));
  const links = linksQ.data || [];
  const pending = links.find((l) => ['requested', 'awaiting_user', 'code_received'].includes(l.status));
  const soon = links.find((l) => l.status === 'linked' && l.valid_until && new Date(l.valid_until) - new Date() < 14 * 86400000);

  if (cfgQ.isLoading) return <TenantShell title="Bank"><p className="text-[13px] text-neutral-400">Loading…</p></TenantShell>;
  const tabBtn = (k, label, n) => <button key={k} onClick={() => setTab(k)} className={`h-8 px-3 text-[12px] border ${tab === k ? 'bg-neutral-900 text-white border-neutral-900' : 'bg-white border-neutral-300 text-neutral-600'}`}>{label}{n != null && <span className="ml-1.5 font-fig opacity-70">{n}</span>}</button>;

  return (
    <TenantShell title="Bank" subtitle="Read-only access to PB Abbey's accounts. Payments are matched to the rent; nothing can be paid from here."
      actions={cfg?.app_id && (accQ.data || []).length > 0 && <Button variant="outline" className="gap-2 border-neutral-300" onClick={() => syncNow.mutate()} disabled={syncNow.isPending}><RefreshCw className="w-4 h-4" /> {syncNow.isSuccess ? 'Requested' : 'Sync now'}</Button>}>
      {!cfg?.app_id ? <Setup cfg={cfg} onSaved={() => qc.invalidateQueries({ queryKey: ['bank_cfg'] })} /> : <>
        {/* accounts + linking */}
        <div className="mb-8 grid md:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] gap-4">
          <div className="bg-white border rule">
            <p className="px-4 py-2.5 border-b rule text-[11px] uppercase tracking-[0.1em] text-neutral-400">Accounts</p>
            <ul className="divide-y divide-neutral-200">
              {(accQ.data || []).map((a) => (
                <li key={a.id} className="px-4 py-3 flex items-center justify-between gap-3">
                  <div className="min-w-0"><p className="font-medium flex items-center gap-1.5"><Landmark className="w-4 h-4 text-neutral-400" />{a.name}</p><p className="text-[12px] text-neutral-500 font-fig">{a.bank}{a.iban ? ` · ${a.iban}` : ''} · synced {a.last_sync ? fmtDate(a.last_sync) : 'not yet'}</p></div>
                  <p className="font-fig text-[16px] shrink-0">{a.balance != null ? gbp(a.balance) : '—'}</p>
                </li>
              ))}
              {!(accQ.data || []).length && <li className="px-4 py-6 text-[13px] text-neutral-500">No account connected yet.</li>}
            </ul>
          </div>
          <div className="bg-white border rule p-4 flex flex-col gap-3 text-[13px]">
            {soon && <p className="text-amber-800 bg-amber-50 border border-amber-200 px-3 py-2">The access to {soon.aspsp_name} ends on {fmtDate(soon.valid_until)}. Connect it again to keep payments coming in.</p>}
            {pending?.status === 'awaiting_user' && pending.auth_url && <div className="bg-sky-50 border border-sky-200 px-3 py-2">
              <p className="font-medium">Peter: approve the access at {pending.aspsp_name}</p>
              <a href={pending.auth_url} className="mt-2 inline-flex items-center gap-1.5 h-9 px-3 bg-neutral-900 text-white"><ExternalLink className="w-4 h-4" /> Open {pending.aspsp_name}</a>
              <p className="mt-1 text-[11px] text-neutral-500">You log in on the bank's own site; PB Abbey never sees the password. You come back here afterwards.</p></div>}
            {pending && pending.status !== 'awaiting_user' && <p className="text-neutral-600">{pending.status === 'requested' ? 'Preparing the link with the bank…' : 'Connecting the accounts…'}</p>}
            {links.filter((l) => l.status === 'error').slice(0, 1).map((l) => <p key={l.id} className="text-red-700">Last attempt with {l.aspsp_name} failed: {l.error}</p>)}
            <p className="text-[11px] uppercase tracking-[0.1em] text-neutral-400">Connect a bank</p>
            {listQ.data?.banks ? (
              <select id="bank-pick" defaultValue="" onChange={(e) => e.target.value && connect.mutate(e.target.value)} className="h-9 px-2 border border-neutral-300 bg-white text-[13px]">
                <option value="" disabled>Choose the bank…</option>
                {listQ.data.banks.map((b) => <option key={b.name} value={b.name}>{b.name}</option>)}
              </select>
            ) : <Button variant="outline" className="border-neutral-300 self-start" onClick={() => askBanks.mutate()} disabled={askBanks.isPending || askBanks.isSuccess}>{askBanks.isSuccess ? 'Loading the list of banks…' : 'Show the list of banks'}</Button>}
            {listQ.data?.error && <p className="text-red-700 text-[12px]">{listQ.data.error}</p>}
          </div>
        </div>

        {/* transactions */}
        <div className="mb-3 flex flex-wrap gap-2">
          {tabBtn('suggested', 'To confirm', credits.filter((t) => t.match_status === 'suggested').length)}
          {tabBtn('unmatched', 'Money in, not matched', credits.filter((t) => t.match_status === 'unmatched').length)}
          {tabBtn('matched', 'Matched', credits.filter((t) => t.match_status === 'matched').length)}
          {tabBtn('all', 'All transactions')}
        </div>
        <ul className="bg-white border rule divide-y divide-neutral-200">
          {rows.slice(0, 300).map((t) => {
            const p = byId[t.rent_payment_id];
            return (
              <li key={t.id} className="px-4 py-3 flex flex-col md:flex-row md:items-center gap-2 md:gap-4">
                <div className="min-w-0 flex-1">
                  <p className="text-[14px]"><span className={`font-fig font-medium ${t.amount > 0 ? 'text-emerald-700' : 'text-neutral-800'}`}>{t.amount > 0 ? '+' : ''}{gbp(t.amount)}</span> <span className="text-neutral-500">· {fmtDate(t.booking_date)}</span> {t.counterparty && <span className="font-medium">· {t.counterparty}</span>}</p>
                  {t.remittance && <p className="text-[12px] text-neutral-500 break-words">{t.remittance}</p>}
                  {p && <p className="text-[12px] mt-0.5">{t.match_status === 'matched' ? 'Pays' : 'Probably'}: <b>{p.tenant_name}</b> · {p.notes?.split(' — ')[0]} · due {fmtDate(p.due_date)}{t.matched_by === 'auto' ? <span className="text-neutral-400"> · matched automatically</span> : ''}</p>}
                  {pick === t.id && (
                    <select autoFocus defaultValue="" onChange={(e) => e.target.value && confirm.mutate({ tx: t.id, rent: e.target.value })} className="mt-2 h-9 w-full max-w-xl px-2 border border-neutral-300 bg-white text-[13px]">
                      <option value="" disabled>Which rent does this pay?</option>
                      {open.map((o) => <option key={o.id} value={o.id}>{o.tenant_name} · {o.notes?.split(' — ')[0]} · due {fmtDate(o.due_date)} · {gbp(o.outstanding)} owed</option>)}
                    </select>
                  )}
                </div>
                {t.amount > 0 && t.match_status !== 'matched' && (
                  <div className="flex flex-wrap gap-1.5 shrink-0">
                    {t.match_status === 'suggested' && p && <button onClick={() => confirm.mutate({ tx: t.id, rent: p.id })} className="h-8 px-2.5 inline-flex items-center gap-1 text-[12px] bg-neutral-900 text-white"><Check className="w-3.5 h-3.5" /> Yes</button>}
                    <button onClick={() => setPick(pick === t.id ? null : t.id)} className="h-8 px-2.5 text-[12px] border border-neutral-300 text-neutral-600">Other rent…</button>
                    {t.match_status !== 'ignored' && <button onClick={() => ignore.mutate(t.id)} className="h-8 px-2.5 inline-flex items-center gap-1 text-[12px] border border-neutral-300 text-neutral-500"><X className="w-3.5 h-3.5" /> Not rent</button>}
                  </div>
                )}
              </li>
            );
          })}
          {!rows.length && <li className="px-4 py-8 text-center text-[13px] text-neutral-400">{(accQ.data || []).length ? 'Nothing here.' : 'Transactions appear here once an account is connected.'}</li>}
        </ul>
        <p className="mt-2 text-[12px] text-neutral-500">Read twice a day (6:00 and 18:00). A payment is matched on its own only when the tenant's name is on it and the amount is exactly what they owe; each confirmation teaches the app the name used on the bank line.</p>
      </>}
    </TenantShell>
  );
}

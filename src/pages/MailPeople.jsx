/* Hallmark · genre: modern-minimal · macrostructure: Outlook People (list | card) · theme: ledger-swiss
 * The mailbox's Exchange contacts (same list as Outlook / phones synced to the mailbox):
 * search, add, edit, delete, email. Below them, the people you correspond with most,
 * to save as contacts in one click. */
import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Mail as MailIcon, Phone, MapPin, Building2, Pencil, Trash2, Loader2, ArrowLeft, UserPlus, X, StickyNote } from 'lucide-react';
import OutlookFrame, { AccountSwitch, Avatar, BarSearch, savedAccount, saveAccount } from '@/components/mail/OutlookHeader';
import { mail } from '@/api/mailClient';

const EMPTY = { givenName: '', surname: '', company: '', jobTitle: '', emails: [''], mobile: '', business: '', home: '', address: { street: '', city: '', postcode: '', country: '' }, notes: '' };

export default function MailPeople() {
  const qc = useQueryClient();
  const nav = useNavigate();
  const accounts = useQuery({ queryKey: ['mail', 'accounts'], queryFn: () => mail.accounts(), refetchOnWindowFocus: false, retry: false });
  const accs = accounts.data?.accounts ?? [];
  const [account, setAccount] = useState(savedAccount);
  const acc = (accs.some((a) => a.id === account) ? account : null) ?? accs[0]?.id ?? null;
  const peopleQ = useQuery({ queryKey: ['mail', 'people', acc], enabled: !!acc, retry: false, queryFn: () => mail.people(acc).then((r) => r.contacts || []) });
  const freqQ = useQuery({ queryKey: ['mail', 'contacts', acc], enabled: !!acc, staleTime: 10 * 60e3, queryFn: () => mail.contacts(acc).then((r) => r.contacts || []) });
  const people = peopleQ.data || [];
  const [q, setQ] = useState('');
  const [openId, setOpenId] = useState(null);
  const [form, setForm] = useState(null); // contact being edited / created
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(null);

  const needle = q.trim().toLowerCase();
  const shown = people.filter((p) => !needle || [p.name, p.company, ...(p.emails || []), p.mobile, p.business].join(' ').toLowerCase().includes(needle));
  const saved = new Set(people.flatMap((p) => (p.emails || []).map((e) => e.toLowerCase())));
  const frequent = (freqQ.data || []).filter((c) => !saved.has(c.email) && (!needle || `${c.name} ${c.email}`.toLowerCase().includes(needle))).slice(0, needle ? 30 : 15);
  const groups = useMemo(() => {
    const g = {};
    shown.forEach((p) => { const k = (p.name || p.emails?.[0] || '#')[0].toUpperCase(); (g[/[A-Z]/.test(k) ? k : '#'] ||= []).push(p); });
    return Object.entries(g).sort(([a], [b]) => a.localeCompare(b));
  }, [shown]);
  const open = people.find((p) => p.id === openId);

  const switchAcc = (id) => { setAccount(id); saveAccount(id); setOpenId(null); setForm(null); };
  const startNew = (prefill = {}) => { setErr(null); setOpenId(null); setForm({ ...EMPTY, ...prefill, emails: prefill.emails?.length ? prefill.emails : [''] }); };
  const startEdit = (p) => { setErr(null); setForm({ ...EMPTY, ...p, emails: p.emails?.length ? p.emails : [''], address: { ...EMPTY.address, ...(p.address || {}) } }); };
  const save = async () => {
    setSaving(true); setErr(null);
    try {
      const r = await mail.personSave(acc, { ...form, emails: form.emails.filter((e) => e.trim()) });
      await qc.invalidateQueries({ queryKey: ['mail', 'people', acc] });
      setOpenId(r.id || form.id || null); setForm(null);
    } catch (e) { setErr(e.message); } finally { setSaving(false); }
  };
  const remove = async (p) => {
    if (!confirm(`Delete ${p.name || 'this contact'}? It goes to Deleted Items.`)) return;
    try { await mail.personDelete(acc, p.id); setOpenId(null); qc.invalidateQueries({ queryKey: ['mail', 'people', acc] }); } catch (e) { alert(e.message); }
  };
  const emailTo = (addr) => nav(`/mail?to=${encodeURIComponent(addr)}`);
  const quickSave = (c) => {
    const [given, ...rest] = (c.name || '').split(/\s+/);
    startNew({ givenName: c.name ? given : '', surname: c.name ? rest.join(' ') : '', emails: [c.email] });
  };

  const paneOpen = !!form || !!open;
  const input = 'h-9 w-full rounded-md border border-[#d1d1d1] px-2.5 text-[13px] bg-white focus:outline-none focus:border-ol';
  const label = 'text-[13px] font-semibold text-ol-text mb-1 block';

  return (
    <OutlookFrame me={accs.find((a) => a.id === acc) || null}
      search={<BarSearch value={q} onChange={setQ} onClear={() => setQ('')} placeholder="Search people" />}>
      <div className="mx-2 md:ml-0 mt-2 px-2 py-1.5 bg-white rounded-lg shadow-[0_0_2px_rgba(0,0,0,0.12),0_1px_2px_rgba(0,0,0,0.14)] flex flex-wrap items-center gap-2 shrink-0">
        <button onClick={() => startNew()} className="inline-flex items-center gap-1.5 h-8 pl-2.5 pr-3 rounded-md bg-ol hover:bg-ol-hover text-white text-[14px] font-semibold"><Plus className="w-4 h-4" /> New contact</button>
        <span className="ml-auto"><AccountSwitch accounts={accs} value={acc} onChange={switchAcc} /></span>
      </div>
      <div className="flex-1 min-h-0 flex md:gap-2 pt-2 md:pr-2 md:pb-2">
        <aside className={`${paneOpen ? 'hidden md:flex' : 'flex'} w-full md:w-[360px] shrink-0 bg-white md:rounded-lg md:shadow-[0_0_2px_rgba(0,0,0,0.12),0_2px_4px_rgba(0,0,0,0.14)] flex-col min-h-0 overflow-hidden`}>
          <div className="flex-1 min-h-0 overflow-y-auto">
            {peopleQ.isLoading && <p className="px-4 py-6 text-[13px] text-neutral-400">Loading contacts…</p>}
            {peopleQ.isError && <p className="px-4 py-6 text-[13px] text-red-600">{String(peopleQ.error.message)}</p>}
            {!peopleQ.isLoading && people.length === 0 && !needle && <p className="px-4 py-5 text-[13px] text-neutral-500">No saved contacts in this mailbox yet. Add one, or save someone you write to from the list below.</p>}
            {groups.map(([letter, list]) => (
              <section key={letter}>
                <h3 className="px-4 pt-3 pb-1 text-[13px] font-semibold text-ol">{letter}</h3>
                {list.map((p) => (
                  <button key={p.id} onClick={() => { setForm(null); setOpenId(p.id); }} className={`w-full text-left px-4 py-2 flex items-center gap-3 ${openId === p.id ? 'bg-ol-sel' : 'hover:bg-ol-hover2'}`}>
                    <Avatar name={p.name || p.emails?.[0]} size={32} />
                    <span className="min-w-0"><span className="block text-[13.5px] truncate">{p.name || p.emails[0]}</span><span className="block text-[12px] text-neutral-500 truncate">{[p.company, p.emails[0]].filter(Boolean).join(' · ')}</span></span>
                  </button>
                ))}
              </section>
            ))}
            {needle && shown.length === 0 && frequent.length === 0 && <p className="px-4 py-5 text-[13px] text-neutral-400">Nobody matches “{q}”.</p>}
            {frequent.length > 0 && (
              <section className="mt-3 border-t border-ol-line">
                <h3 className="px-4 pt-3 pb-1 text-[13px] font-semibold text-ol-text">People you email (not saved)</h3>
                {frequent.map((c) => (
                  <div key={c.email} className="px-4 py-1.5 flex items-center gap-3 hover:bg-ol-hover2"><Avatar name={c.name || c.email} size={32} />
                    <span className="min-w-0 flex-1"><span className="block text-[13px] truncate">{c.name || c.email}</span>{c.name && <span className="block text-[11.5px] text-neutral-500 truncate">{c.email}</span>}</span>
                    <button onClick={() => emailTo(c.email)} title="Email" className="w-8 h-8 rounded-md flex items-center justify-center text-ol-sub hover:bg-ol-bg hover:text-ol"><MailIcon className="w-4 h-4" /></button>
                    <button onClick={() => quickSave(c)} title="Save as a contact" className="w-8 h-8 rounded-md flex items-center justify-center text-ol-sub hover:bg-ol-bg hover:text-ol"><UserPlus className="w-4 h-4" /></button>
                  </div>
                ))}
              </section>
            )}
          </div>
        </aside>

        <main className={`${paneOpen ? 'flex' : 'hidden md:flex'} flex-1 min-w-0 flex-col bg-white md:rounded-lg md:shadow-[0_0_2px_rgba(0,0,0,0.12),0_2px_4px_rgba(0,0,0,0.14)] overflow-y-auto`}>
          {!paneOpen && <div className="flex-1 flex items-center justify-center text-center"><div><p className="text-[15px] font-semibold text-ol-text">Select a contact to see the details</p><p className="text-[13px] text-ol-sub mt-1">or add a new one with New contact.</p></div></div>}

          {open && !form && (
            <div className="max-w-2xl w-full px-4 md:px-10 py-6">
              <button onClick={() => setOpenId(null)} className="md:hidden mb-4 inline-flex items-center gap-1 text-[13px] text-neutral-500"><ArrowLeft className="w-4 h-4" /> People</button>
              <div className="flex items-center gap-4">
                <Avatar name={open.name || open.emails?.[0]} size={72} />
                <div className="min-w-0">
                  <h1 className="text-[22px] font-semibold tracking-tight break-words">{open.name}</h1>
                  {(open.jobTitle || open.company) && <p className="text-[13px] text-neutral-500">{[open.jobTitle, open.company].filter(Boolean).join(', ')}</p>}
                </div>
              </div>
              <div className="mt-5 flex flex-wrap gap-2">
                {open.emails[0] && <button onClick={() => emailTo(open.emails[0])} className="h-9 px-3 rounded-md bg-ol hover:bg-ol-hover text-white text-[14px] font-semibold inline-flex items-center gap-1.5"><MailIcon className="w-4 h-4" /> Email</button>}
                {(open.mobile || open.business) && <a href={`tel:${(open.mobile || open.business).replace(/\s+/g, '')}`} className="h-9 px-3 rounded-md border border-ol-line bg-white text-[14px] inline-flex items-center gap-1.5 hover:bg-ol-bg"><Phone className="w-4 h-4" /> Call</a>}
                <button onClick={() => startEdit(open)} className="h-9 px-3 rounded-md border border-ol-line bg-white text-[14px] inline-flex items-center gap-1.5 hover:bg-ol-bg"><Pencil className="w-4 h-4" /> Edit</button>
                <button onClick={() => remove(open)} className="h-9 px-3 rounded-md border border-red-200 bg-white text-red-700 text-[14px] inline-flex items-center gap-1.5 hover:bg-red-50"><Trash2 className="w-4 h-4" /> Delete</button>
              </div>
              <dl className="mt-6 bg-white border rule divide-y divide-neutral-100 text-[13.5px]">
                {open.emails.map((e) => <div key={e} className="px-4 py-3 flex gap-3"><MailIcon className="w-4 h-4 text-neutral-400 mt-0.5" /><button onClick={() => emailTo(e)} className="text-sky-800 hover:underline break-all text-left">{e}</button></div>)}
                {[['Mobile', open.mobile], ['Work', open.business], ['Home', open.home]].filter(([, v]) => v).map(([l, v]) => <div key={l} className="px-4 py-3 flex gap-3"><Phone className="w-4 h-4 text-neutral-400 mt-0.5" /><a href={`tel:${v.replace(/\s+/g, '')}`} className="hover:underline">{v}</a><span className="text-neutral-400 text-[12px] ml-auto">{l}</span></div>)}
                {open.company && <div className="px-4 py-3 flex gap-3"><Building2 className="w-4 h-4 text-neutral-400 mt-0.5" /><span>{open.company}</span></div>}
                {open.address && Object.values(open.address).some(Boolean) && <div className="px-4 py-3 flex gap-3"><MapPin className="w-4 h-4 text-neutral-400 mt-0.5" /><span>{[open.address.street, [open.address.postcode, open.address.city].filter(Boolean).join(' '), open.address.country].filter(Boolean).join(', ')}</span></div>}
                {open.notes?.trim() && <div className="px-4 py-3 flex gap-3"><StickyNote className="w-4 h-4 text-neutral-400 mt-0.5" /><p className="whitespace-pre-wrap">{open.notes.trim()}</p></div>}
              </dl>
            </div>
          )}

          {form && (
            <div className="max-w-2xl w-full px-4 md:px-10 py-6">
              <button onClick={() => setForm(null)} className="md:hidden mb-4 inline-flex items-center gap-1 text-[13px] text-neutral-500"><ArrowLeft className="w-4 h-4" /> Back</button>
              <h1 className="text-[18px] font-semibold mb-5">{form.id ? 'Edit contact' : 'New contact'}</h1>
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <div><span className={label}>First name</span><input autoFocus value={form.givenName} onChange={(e) => setForm({ ...form, givenName: e.target.value })} className={input} /></div>
                  <div><span className={label}>Last name</span><input value={form.surname} onChange={(e) => setForm({ ...form, surname: e.target.value })} className={input} /></div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div><span className={label}>Company</span><input value={form.company} onChange={(e) => setForm({ ...form, company: e.target.value })} className={input} /></div>
                  <div><span className={label}>Job title</span><input value={form.jobTitle} onChange={(e) => setForm({ ...form, jobTitle: e.target.value })} className={input} /></div>
                </div>
                <div><span className={label}>Email</span>
                  <div className="space-y-1.5">
                    {form.emails.map((e, i) => (
                      <div key={i} className="flex gap-1.5">
                        <input type="email" value={e} onChange={(ev) => { const em = [...form.emails]; em[i] = ev.target.value; setForm({ ...form, emails: em }); }} className={input} placeholder="name@example.com" />
                        {form.emails.length > 1 && <button onClick={() => setForm({ ...form, emails: form.emails.filter((_, j) => j !== i) })} className="px-2 text-neutral-400 hover:text-neutral-900" aria-label="Remove"><X className="w-4 h-4" /></button>}
                      </div>
                    ))}
                    {form.emails.length < 3 && <button onClick={() => setForm({ ...form, emails: [...form.emails, ''] })} className="text-[12px] text-neutral-500 hover:text-neutral-900">+ Another email</button>}
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  {[['mobile', 'Mobile'], ['business', 'Work phone'], ['home', 'Home phone']].map(([k, l]) => <div key={k}><span className={label}>{l}</span><input type="tel" value={form[k]} onChange={(e) => setForm({ ...form, [k]: e.target.value })} className={input} /></div>)}
                </div>
                <div><span className={label}>Address</span>
                  <input value={form.address.street} onChange={(e) => setForm({ ...form, address: { ...form.address, street: e.target.value } })} placeholder="Street" className={input} />
                  <div className="grid grid-cols-3 gap-1.5 mt-1.5">
                    <input value={form.address.postcode} onChange={(e) => setForm({ ...form, address: { ...form.address, postcode: e.target.value } })} placeholder="Postcode" className={input} />
                    <input value={form.address.city} onChange={(e) => setForm({ ...form, address: { ...form.address, city: e.target.value } })} placeholder="City" className={input} />
                    <input value={form.address.country} onChange={(e) => setForm({ ...form, address: { ...form.address, country: e.target.value } })} placeholder="Country" className={input} />
                  </div>
                </div>
                <div><span className={label}>Notes</span><textarea rows={3} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} className="w-full rounded-md border border-[#d1d1d1] px-2.5 py-2 text-[13px] focus:outline-none focus:border-ol" /></div>
              </div>
              <div className="mt-6 flex items-center gap-3">
                <button onClick={save} disabled={saving} className="h-9 px-4 rounded-md bg-ol hover:bg-ol-hover text-white text-[14px] font-semibold inline-flex items-center gap-2 disabled:opacity-50">{saving && <Loader2 className="w-4 h-4 animate-spin" />} Save</button>
                <button onClick={() => setForm(null)} className="h-9 px-3 text-[13px] text-neutral-500 hover:text-neutral-900">Cancel</button>
                {err && <span className="text-[12px] text-red-600">{err}</span>}
              </div>
            </div>
          )}
        </main>
      </div>
    </OutlookFrame>
  );
}

/* Hallmark · genre: modern-minimal · macrostructure: Agenda + Ledger · theme: ledger-swiss
 * tone: utilitarian · ink + hairlines + mono figures · motion: cut
 * Company: the agenda of everything PB Abbey has to do — own tasks, legal deadlines
 * (Companies House / HMRC), VAT returns, rent due, certificates — merged with the
 * office@ and accounts@ Outlook calendars (Exchange). Second tab: the company record. */
import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { LayoutGrid, ExternalLink, Check, Undo2, FileSpreadsheet, Plus, X, CalendarDays, Landmark, Percent, PoundSterling, ShieldAlert, ListTodo, Repeat, Trash2, Loader2, MapPin } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { mail } from '@/api/mailClient';
import { useAuth } from '@/lib/AuthContext';
import { rentStatus } from '@/pages/tenant/ui';
import { COMPANY, TEAM, companyDeadlines, daysUntil, fmtDate, vatDeadlines, iso, personName, nextOccurrence } from '@/lib/company';

const FILINGS = 'company_filings';
const SYNC = 'outlook_sync';
const HORIZON_DAYS = 183;
const addDays = (n, from = new Date()) => { const d = new Date(from); d.setDate(d.getDate() + n); return iso(d); };
const at = (s) => new Date(`${s}T12:00:00`);
const gbp = (n) => `£${(Number(n) || 0).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const CAL_LABEL = { office: 'office@', accounts: 'accounts@' };

async function upsertSetting(id, value, user) {
  try { await base44.entities.AppSetting.update(id, { value, updated_by: user?.email || '', updated_date: new Date().toISOString() }); }
  catch { await base44.entities.AppSetting.create({ id, value, updated_by: user?.email || '' }); }
}

function Section({ title, sub, children, right }) {
  return (
    <section className="mt-10">
      <div className="flex items-end justify-between gap-4">
        <div className="min-w-0">
          <h2 className="text-[15px] font-semibold tracking-tight">{title}</h2>
          {sub && <p className="text-[12px] text-neutral-500 mt-0.5">{sub}</p>}
        </div>
        {right}
      </div>
      <div className="mt-3">{children}</div>
    </section>
  );
}

// ---------------- Agenda ----------------

function useAgenda() {
  const today = iso(new Date());
  const to = addDays(HORIZON_DAYS);
  const q = (key, fn, extra = {}) => useQuery({ queryKey: key, queryFn: fn, staleTime: 30000, ...extra });
  const tasks = q(['company_tasks'], () => base44.entities.CompanyTask.list('due_date', 2000));
  const filings = q(['app_settings', FILINGS], () => base44.entities.AppSetting.get(FILINGS).catch(() => null));
  const vatSettings = q(['app_settings', 'vat_settings'], () => base44.entities.AppSetting.get('vat_settings').catch(() => null));
  const vatSaved = q(['vat_quarters'], () => base44.entities.VATQuarter.list('-end_date'));
  const rent = q(['rent_payments'], () => base44.entities.RentPayment.list('-due_date'));
  const certs = q(['compliance'], () => base44.entities.Compliance.list('expiry_date'));
  const calFrom = `${addDays(-1)}T00:00:00Z`, calTo = `${to}T23:59:59Z`;
  const cal = (acc) => q(['calendar', acc, calFrom.slice(0, 10)], () => mail.calendar(acc, calFrom, calTo), { retry: 1, refetchOnWindowFocus: false });
  const office = cal('office'), accounts = cal('accounts');

  const items = useMemo(() => {
    const out = [];
    // Own tasks: open ones (incl. late), plus done ones of the last week.
    (tasks.data || []).forEach((t) => {
      if (t.done && (t.done_at || '').slice(0, 10) < addDays(-7)) return;
      if (!t.done && t.due_date > to) return;
      out.push({ id: `task:${t.id}`, type: 'task', date: t.due_date, time: t.due_time, title: t.title, task: t, done: t.done,
        sub: [t.assignee ? personName(t.assignee) : 'Anyone', t.recurrence !== 'none' ? `every ${{ monthly: 'month', quarterly: 'quarter', yearly: 'year' }[t.recurrence]}` : '', t.calendar ? `in Outlook (${CAL_LABEL[t.calendar]})` : '', t.notes].filter(Boolean).join(' · ') });
    });
    // Legal deadlines (always shown: there are only four).
    companyDeadlines(filings.data?.value?.filed || {}).forEach((d) => out.push({ id: `legal:${d.key}`, type: 'legal', date: d.due, title: d.label, sub: `${d.who} · ${d.periodLabel}`, deadline: d }));
    // VAT returns: unfiled quarters with a deadline in the window (or late, last 4 months).
    const stagger = vatSettings.data?.value?.stagger || 1;
    const filedQ = new Set((vatSaved.data || []).filter((v) => v.status === 'submitted').map((v) => v.quarter_id));
    vatDeadlines(stagger, addDays(-120), to).filter((v) => !filedQ.has(v.key) && (v.deadline >= today || v.end < today))
      .forEach((v) => out.push({ id: `vat:${v.key}`, type: 'vat', date: v.deadline, title: 'VAT return', sub: `HMRC · quarter ${v.label}`, link: '/VATReturn' }));
    // Rent: unpaid invoices due in the window or already late.
    (rent.data || []).filter((p) => p.status !== 'paid' && p.due_date && p.due_date <= to && (Number(p.outstanding) || 0) > 0)
      .forEach((p) => out.push({ id: `rent:${p.id}`, type: 'rent', date: p.due_date, title: `Rent ${gbp(p.outstanding)} — ${p.tenant_name}`, sub: rentStatus(p) === 'overdue' ? 'overdue' : 'due', link: '/tenant/rent' }));
    // Certificates expiring in the window.
    (certs.data || []).filter((c) => c.expiry_date && c.expiry_date <= to)
      .forEach((c) => out.push({ id: `cert:${c.id}`, type: 'cert', date: c.expiry_date, title: `${c.type || 'Certificate'} expires`, sub: [c.unit_reference, c.provider].filter(Boolean).join(' · '), link: '/tenant/compliance' }));
    // Outlook events (not the ones this app put there: those already appear above).
    [['office', office], ['accounts', accounts]].forEach(([acc, r]) => (r.data?.events || [])
      .filter((e) => !(e.categories || []).includes('PB Abbey') && e.date >= today)
      .forEach((e) => out.push({ id: `cal:${acc}:${e.id}`, type: 'cal', date: e.date, time: e.allDay ? null : new Date(e.start).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' }),
        title: e.subject, sub: [CAL_LABEL[acc], e.location].filter(Boolean).join(' · '), cancelled: e.cancelled || /^cancel+ed:|annul/i.test(e.subject), location: e.location })));
    return out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : (a.time || '') < (b.time || '') ? -1 : 1));
  }, [tasks.data, filings.data, vatSettings.data, vatSaved.data, rent.data, certs.data, office.data, accounts.data]);

  const calError = office.error || accounts.error;
  const loading = [tasks, filings, rent, certs].some((x) => x.isLoading);
  const calLoading = office.isLoading || accounts.isLoading;
  return { items, loading, calLoading, calError, filings, tasks };
}

const TYPE = {
  task: { icon: ListTodo, label: 'Task' },
  legal: { icon: Landmark, label: 'Legal' },
  vat: { icon: Percent, label: 'VAT' },
  rent: { icon: PoundSterling, label: 'Rent' },
  cert: { icon: ShieldAlert, label: 'Certificate' },
  cal: { icon: CalendarDays, label: 'Calendar' },
};

function groupOf(date) {
  const left = daysUntil(date);
  if (left < 0) return { key: '0', label: 'Late' };
  if (left === 0) return { key: '1', label: 'Today' };
  const d = at(date), now = at(iso(new Date()));
  const weekStart = new Date(now); weekStart.setDate(now.getDate() - ((now.getDay() + 6) % 7));
  const diffWeeks = Math.floor((d - weekStart) / (7 * 86400000));
  if (diffWeeks === 0) return { key: '2', label: 'This week' };
  if (diffWeeks === 1) return { key: '3', label: 'Next week' };
  return { key: `4${date.slice(0, 7)}`, label: d.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }) };
}

function TaskForm({ onClose, onSaved, user }) {
  const [f, setF] = useState({ title: '', due_date: addDays(1), due_time: '', assignee: '', recurrence: 'none', calendar: 'office', notes: '' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const save = async (e) => {
    e.preventDefault();
    if (!f.title.trim() || !f.due_date) return setErr('A title and a date are needed.');
    setBusy(true); setErr(null);
    try {
      const row = await base44.entities.CompanyTask.create({ title: f.title.trim(), due_date: f.due_date, due_time: f.due_time || null, assignee: f.assignee || null,
        recurrence: f.recurrence, calendar: f.calendar || null, notes: f.notes.trim() || null, created_by: user?.email || null });
      if (f.calendar) {
        try {
          const ev = await mail.calendarCreate(f.calendar, { subject: f.title.trim(), body: [f.notes, f.assignee ? `For: ${personName(f.assignee)}` : ''].filter(Boolean).join('\n'), date: f.due_date, time: f.due_time || undefined, reminderMinutes: f.due_time ? 30 : 24 * 60 });
          await base44.entities.CompanyTask.update(row.id, { outlook_id: ev.id });
        } catch (x) { setErr(`Saved, but not added to Outlook: ${x.message}`); setBusy(false); onSaved(); return; }
      }
      onSaved(); onClose();
    } catch (x) { setErr(x.message); }
    setBusy(false);
  };
  const input = 'h-9 px-3 border border-neutral-300 bg-white text-[13px] outline-none focus:border-neutral-900 w-full';
  return (
    <form onSubmit={save} className="bg-white border border-neutral-900 p-4 sm:p-5 mb-4">
      <div className="flex items-center justify-between mb-3">
        <p className="text-[13px] font-semibold">New agenda item</p>
        <button type="button" onClick={onClose} title="Close"><X className="w-4 h-4 text-neutral-400 hover:text-neutral-900" /></button>
      </div>
      <input autoFocus value={f.title} onChange={set('title')} placeholder="What has to be done? e.g. Send rent schedule to Handelsbanken" className={input} />
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-2">
        <label className="text-[11px] text-neutral-500">Date<input type="date" value={f.due_date} onChange={set('due_date')} className={`${input} mt-1`} /></label>
        <label className="text-[11px] text-neutral-500">Time (optional)<input type="time" value={f.due_time} onChange={set('due_time')} className={`${input} mt-1`} /></label>
        <label className="text-[11px] text-neutral-500">Who<select value={f.assignee} onChange={set('assignee')} className={`${input} mt-1`}><option value="">Anyone</option>{TEAM.map((p) => <option key={p.email} value={p.email}>{p.name}</option>)}</select></label>
        <label className="text-[11px] text-neutral-500">Repeat<select value={f.recurrence} onChange={set('recurrence')} className={`${input} mt-1`}><option value="none">No</option><option value="monthly">Every month</option><option value="quarterly">Every quarter</option><option value="yearly">Every year</option></select></label>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-[1fr_200px] gap-2 mt-2">
        <input value={f.notes} onChange={set('notes')} placeholder="Notes (optional)" className={input} />
        <select value={f.calendar} onChange={set('calendar')} className={input}><option value="office">Also in Outlook: office@</option><option value="accounts">Also in Outlook: accounts@</option><option value="">Not in Outlook</option></select>
      </div>
      <div className="flex items-center justify-end gap-3 mt-3">
        {err && <span className="text-[12px] text-red-600 mr-auto">{err}</span>}
        <button type="button" onClick={onClose} className="h-9 px-3 text-[13px] text-neutral-500">Cancel</button>
        <button disabled={busy} className="h-9 px-4 bg-neutral-900 text-white text-[13px] inline-flex items-center gap-2 disabled:opacity-50">{busy && <Loader2 className="w-4 h-4 animate-spin" />} Add</button>
      </div>
    </form>
  );
}

function Agenda() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const { items, loading, calLoading, calError, filings } = useAgenda();
  const [filter, setFilter] = useState('all');
  const [mine, setMine] = useState(false);
  const [adding, setAdding] = useState(false);
  const sync = useQuery({ queryKey: ['app_settings', SYNC], queryFn: () => base44.entities.AppSetting.get(SYNC).catch(() => null) });
  const syncOn = !!sync.data?.value?.enabled;

  const refreshTasks = () => qc.invalidateQueries({ queryKey: ['company_tasks'] });
  const toggleTask = async (t) => {
    if (t.done) { await base44.entities.CompanyTask.update(t.id, { done: false, done_at: null, done_by: null }); return refreshTasks(); }
    await base44.entities.CompanyTask.update(t.id, { done: true, done_at: new Date().toISOString(), done_by: user?.email || null });
    // Repeating: the next one appears straight away (and in Outlook if this one was).
    const next = nextOccurrence(t.due_date, t.recurrence);
    if (next) {
      const row = await base44.entities.CompanyTask.create({ title: t.title, notes: t.notes, due_date: next, due_time: t.due_time, assignee: t.assignee, recurrence: t.recurrence, calendar: t.calendar, created_by: user?.email || null });
      if (t.calendar) mail.calendarCreate(t.calendar, { subject: t.title, body: t.notes || '', date: next, time: t.due_time || undefined, reminderMinutes: t.due_time ? 30 : 24 * 60 })
        .then((ev) => base44.entities.CompanyTask.update(row.id, { outlook_id: ev.id })).catch(() => {}).finally(refreshTasks);
    }
    refreshTasks();
  };
  const removeTask = async (t) => {
    if (!confirm(`Delete "${t.title}"?${t.outlook_id ? '\nIt is removed from Outlook too.' : ''}`)) return;
    if (t.outlook_id && t.calendar) { try { await mail.calendarDelete(t.calendar, t.outlook_id); } catch { /* already gone */ } }
    await base44.entities.CompanyTask.delete(t.id);
    refreshTasks();
  };
  const markLegal = async (d) => {
    if (!confirm(`Mark "${d.label}" (${d.periodLabel}) as done?\n\nThe next one will appear in its place.`)) return;
    const value = filings.data?.value || {};
    await upsertSetting(FILINGS, { ...value, filed: { ...(value.filed || {}), [d.key]: { at: new Date().toISOString(), by: user?.email || '' } } }, user);
    qc.invalidateQueries({ queryKey: ['app_settings', FILINGS] });
  };
  const toggleSync = async () => {
    const value = sync.data?.value || {};
    if (!syncOn && !confirm('Put the legal and VAT deadlines in the office@ Outlook calendar?\n\nThey appear as all-day events with a reminder 2 weeks before, on every phone and computer connected to office@. They are removed again once marked done (or if you switch this off).')) return;
    await upsertSetting(SYNC, { ...value, enabled: !syncOn, account: 'office' }, user);
    qc.invalidateQueries({ queryKey: ['app_settings', SYNC] });
  };

  const shown = items.filter((i) => (filter === 'all' || (filter === 'todo' ? i.type !== 'cal' : i.type === 'cal'))
    && (!mine || (i.type === 'task' && (!i.task.assignee || i.task.assignee === (user?.email || '').toLowerCase())) || (i.type !== 'task' && i.type !== 'cal')));
  const groups = [];
  shown.forEach((i) => {
    const g = i.type === 'task' && i.done ? { key: '9', label: 'Done this week' } : groupOf(i.date);
    let G = groups.find((x) => x.key === g.key);
    if (!G) groups.push((G = { ...g, items: [] }));
    G.items.push(i);
  });
  groups.sort((a, b) => (a.key < b.key ? -1 : 1));
  const lateCount = items.filter((i) => i.type !== 'cal' && !i.done && daysUntil(i.date) < 0).length;
  const chip = (k, label) => <button key={k} onClick={() => setFilter(k)} className={`h-8 px-3 text-[12px] border ${filter === k ? 'bg-neutral-900 text-white border-neutral-900' : 'bg-white border-neutral-300 text-neutral-600 hover:border-neutral-900'}`}>{label}</button>;

  return (
    <>
      <div className="mt-6 flex flex-wrap items-center gap-2">
        {chip('all', 'Everything')}{chip('todo', 'To do')}{chip('cal', 'Calendar')}
        <label className="ml-1 inline-flex items-center gap-1.5 text-[12px] text-neutral-600 cursor-pointer select-none"><input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} className="accent-neutral-900" /> Only mine</label>
        <button onClick={() => setAdding(true)} className="ml-auto inline-flex items-center gap-1.5 h-9 px-4 bg-neutral-900 text-white text-[13px]"><Plus className="w-4 h-4" /> Add</button>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-neutral-500">
        {lateCount > 0 && <span className="text-red-700">{lateCount} late</span>}
        <span>Next 6 months · office@ and accounts@ calendars included{calLoading ? ' (loading…)' : ''}</span>
        {calError && <span className="text-red-600">Outlook calendar unavailable: {String(calError.message).slice(0, 80)}</span>}
        <button onClick={toggleSync} className="underline hover:text-neutral-900">{syncOn ? 'Deadlines are in Outlook (office@) — switch off' : 'Put deadlines in Outlook'}</button>
      </div>

      <div className="mt-5">{adding && <TaskForm user={user} onClose={() => setAdding(false)} onSaved={() => { refreshTasks(); qc.invalidateQueries({ queryKey: ['calendar'] }); }} />}</div>

      {loading ? <p className="mt-8 text-[13px] text-neutral-400 flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Loading…</p> : (
        groups.length === 0 ? <p className="mt-6 bg-white border rule px-5 py-6 text-[13px] text-neutral-500">Nothing here.</p> :
        groups.map((g) => (
          <section key={g.key} className="mt-6">
            <h3 className={`text-[11px] uppercase tracking-[0.1em] font-medium mb-2 ${g.label === 'Late' ? 'text-red-700' : 'text-neutral-400'}`}>{g.label}</h3>
            <ul className="bg-white border rule divide-y divide-neutral-100">
              {g.items.map((i) => {
                const T = TYPE[i.type]; const left = daysUntil(i.date);
                const d = at(i.date);
                const urgent = i.type !== 'cal' && !i.done && left <= 14;
                return (
                  <li key={i.id} className={`flex items-start gap-3 px-3 sm:px-4 py-3 ${i.done || i.cancelled ? 'opacity-50' : ''}`}>
                    <div className="w-11 shrink-0 text-center leading-none pt-0.5">
                      <p className="text-[10px] uppercase tracking-wide text-neutral-400">{d.toLocaleDateString('en-GB', { weekday: 'short' })}</p>
                      <p className={`font-fig text-[17px] mt-1 ${urgent ? 'text-red-700' : 'text-neutral-900'}`}>{d.getDate()}</p>
                      <p className="text-[10px] text-neutral-400 mt-0.5">{d.toLocaleDateString('en-GB', { month: 'short' })}</p>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className={`text-[14px] ${i.done || i.cancelled ? 'line-through' : ''} ${i.type === 'cal' ? 'text-neutral-800' : 'font-semibold text-neutral-900'} break-words`}>
                        {i.time && <span className="font-fig text-[12px] text-neutral-500 mr-1.5">{i.time}</span>}{i.title}
                      </p>
                      <p className="text-[12px] text-neutral-500 mt-0.5 flex items-center gap-1.5 flex-wrap">
                        <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wide text-neutral-400"><T.icon className="w-3 h-3" /> {T.label}</span>
                        {i.sub && <span className="break-words">· {i.sub}</span>}
                        {i.type !== 'cal' && !i.done && <span className={left < 0 ? 'text-red-700' : left <= 14 ? 'text-red-700' : ''}>· {left < 0 ? `${-left} day${left === -1 ? '' : 's'} late` : left === 0 ? 'today' : `in ${left} day${left === 1 ? '' : 's'}`}</span>}
                      </p>
                    </div>
                    <div className="shrink-0 flex items-center gap-1 pt-0.5">
                      {i.type === 'task' && <>
                        <button onClick={() => toggleTask(i.task)} title={i.done ? 'Not done' : 'Done'} className={`h-8 w-8 border inline-flex items-center justify-center ${i.done ? 'bg-neutral-900 border-neutral-900 text-white' : 'border-neutral-300 hover:border-neutral-900'}`}>{i.done ? <Undo2 className="w-3.5 h-3.5" /> : <Check className="w-3.5 h-3.5" />}</button>
                        <button onClick={() => removeTask(i.task)} title="Delete" className="h-8 w-8 inline-flex items-center justify-center text-neutral-400 hover:text-red-600"><Trash2 className="w-3.5 h-3.5" /></button>
                      </>}
                      {i.type === 'legal' && <button onClick={() => markLegal(i.deadline)} className="h-8 px-2.5 border border-neutral-300 text-[12px] hover:border-neutral-900 inline-flex items-center gap-1"><Check className="w-3.5 h-3.5" /> Done</button>}
                      {i.link && <Link to={i.link} className="h-8 px-2.5 border border-neutral-300 text-[12px] hover:border-neutral-900 inline-flex items-center">Open</Link>}
                      {i.type === 'task' && i.task.recurrence !== 'none' && <Repeat className="w-3.5 h-3.5 text-neutral-300" />}
                      {i.type === 'cal' && i.location && <a href={`https://www.google.com/maps/search/${encodeURIComponent(i.location)}`} target="_blank" rel="noopener noreferrer" title="Map" className="h-8 w-8 inline-flex items-center justify-center text-neutral-400 hover:text-neutral-900"><MapPin className="w-3.5 h-3.5" /></a>}
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        ))
      )}
    </>
  );
}

// ---------------- Company record ----------------

function Record() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const setting = useQuery({ queryKey: ['app_settings', FILINGS], queryFn: () => base44.entities.AppSetting.get(FILINGS).catch(() => null) });
  const value = setting.data?.value || {};
  const filed = value.filed || {};
  const done = Object.entries(filed).sort((a, b) => (a[1].at < b[1].at ? 1 : -1));
  const undo = async (key) => { const n = { ...filed }; delete n[key]; await upsertSetting(FILINGS, { ...value, filed: n }, user); qc.invalidateQueries({ queryKey: ['app_settings', FILINGS] }); };
  const kindLabel = (key) => companyDeadlines({}).find((x) => key.startsWith(`${x.kind}:`))?.label || key;

  return (
    <>
      <Section title="Legal deadlines" sub="Companies House and HMRC. Reminder emails go to Peter and Christine 30, 14, 7 and 1 days before. Mark them done in the agenda.">
        <ul className="bg-white border rule divide-y divide-neutral-200">
          {companyDeadlines(filed).map((d) => (
            <li key={d.key} className="px-4 sm:px-5 py-3.5 flex flex-col sm:flex-row sm:items-start gap-2">
              <div className="flex-1 min-w-0">
                <p className="text-[14px] font-semibold">{d.label} <span className="text-[11px] font-normal uppercase tracking-[0.1em] text-neutral-400 ml-1">{d.who}</span></p>
                <p className="text-[12px] text-neutral-500 mt-0.5">{d.periodLabel}. {d.how} <a href={d.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 underline hover:text-neutral-900">gov.uk <ExternalLink className="w-3 h-3" /></a></p>
              </div>
              <p className="font-fig text-[13px] shrink-0 sm:text-right">{fmtDate(d.due)}<span className="block text-[11px] text-neutral-400 font-sans">in {daysUntil(d.due)} days</span></p>
            </li>
          ))}
        </ul>
        {done.length > 0 && (
          <div className="mt-3 text-[12px] text-neutral-500 space-y-1">
            {done.slice(0, 8).map(([key, v]) => (
              <p key={key} className="flex items-center gap-2 flex-wrap">
                <Check className="w-3.5 h-3.5 text-emerald-700" /> {kindLabel(key)} ({fmtDate(key.split(':')[1])}) — done {new Date(v.at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}{v.by ? ` by ${personName(v.by)}` : ''}
                <button onClick={() => undo(key)} className="inline-flex items-center gap-0.5 underline hover:text-neutral-900"><Undo2 className="w-3 h-3" /> undo</button>
              </p>
            ))}
          </div>
        )}
      </Section>

      <Section title="For the accountant" sub="Everything for the year's accounts in one Excel file: receipts (euros converted at ECB rates), rent, VAT returns.">
        <Link to="/Reports#year-end" className="inline-flex items-center gap-2 h-9 px-4 bg-neutral-900 text-white text-[13px]"><FileSpreadsheet className="w-4 h-4" /> Year-end pack</Link>
      </Section>

      <Section title="Public record" sub={<>From Companies House, checked 5 October 2026. <a href={COMPANY.chUrl} target="_blank" rel="noopener noreferrer" className="underline hover:text-neutral-900">Open the live record</a>.</>}>
        <dl className="bg-white border rule divide-y divide-neutral-200 text-[13px]">
          {[
            ['Company number', COMPANY.number],
            ['Registered office', COMPANY.registeredOffice],
            ['Trading address', COMPANY.tradingAddress],
            ['Incorporated', fmtDate(COMPANY.incorporated)],
            ['Business', COMPANY.sic.join(' · ')],
            ['Financial year', `Ends 29 June (last accounts made up to ${fmtDate(COMPANY.lastAccounts)})`],
          ].map(([k, v]) => (
            <div key={k} className="px-4 sm:px-5 py-3 grid grid-cols-1 sm:grid-cols-[180px_1fr] gap-0.5 sm:gap-4">
              <dt className="text-neutral-400">{k}</dt><dd className="text-neutral-800">{v}</dd>
            </div>
          ))}
          <div className="px-4 sm:px-5 py-3 grid grid-cols-1 sm:grid-cols-[180px_1fr] gap-0.5 sm:gap-4">
            <dt className="text-neutral-400">Directors &amp; owners</dt>
            <dd className="text-neutral-800 space-y-1">{COMPANY.directors.map((p) => <p key={p.name}>{p.name} <span className="text-neutral-400">— {p.note}, since {new Date(p.since).getFullYear()}</span></p>)}</dd>
          </div>
          <div className="px-4 sm:px-5 py-3 grid grid-cols-1 sm:grid-cols-[180px_1fr] gap-0.5 sm:gap-4">
            <dt className="text-neutral-400">Charges (secured loans)</dt>
            <dd className="text-neutral-800 space-y-1">{COMPANY.charges.map((c) => <p key={c.code}>{c.lender} — {c.what} <span className="text-neutral-400 font-fig">· {fmtDate(c.created)} · outstanding</span></p>)}</dd>
          </div>
        </dl>
      </Section>
    </>
  );
}

export default function Company() {
  const [tab, setTab] = useState(() => (window.location.hash === '#record' ? 'record' : 'agenda'));
  const go = (t) => { setTab(t); window.history.replaceState(null, '', t === 'record' ? '#record' : window.location.pathname); };
  return (
    <div className="min-h-screen bg-background text-neutral-900">
      <header className="border-b rule">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 h-12 flex items-center justify-between">
          <span className="font-semibold tracking-tight">PB Abbey · Company</span>
          <Link to="/" className="inline-flex items-center gap-2 text-[13px] text-neutral-500 hover:text-neutral-900"><LayoutGrid className="w-3.5 h-3.5" /> All applications</Link>
        </div>
      </header>
      <main className="max-w-4xl mx-auto px-4 sm:px-6 py-8 pb-16">
        <div className="flex items-end justify-between gap-4 border-b rule">
          <div className="flex gap-6">
            {[['agenda', 'Agenda'], ['record', 'Company']].map(([k, l]) => (
              <button key={k} onClick={() => go(k)} className={`pb-2.5 -mb-px text-[15px] border-b-2 ${tab === k ? 'border-neutral-900 font-semibold text-neutral-900' : 'border-transparent text-neutral-500 hover:text-neutral-900'}`}>{l}</button>
            ))}
          </div>
          <span className="pb-2.5 text-[12px] text-neutral-400 font-fig hidden sm:block">{COMPANY.name} · {COMPANY.number}</span>
        </div>
        {tab === 'agenda' ? <Agenda /> : <Record />}
      </main>
    </div>
  );
}

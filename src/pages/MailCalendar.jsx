/* Hallmark · genre: modern-minimal · macrostructure: Outlook calendar (toolbar + Day/Week/Month/Agenda) · theme: ledger-swiss
 * The Exchange calendar of office@ / accounts@ (EWS through the mail sidecar), Outlook-style:
 * create / edit / delete events, invite people (Exchange sends the invitations), repeat,
 * reminders, show-as, answer invitations, edit one occurrence or the whole series.
 * All times are Paris time (the mailboxes' zone: Peter and Christine live in France). */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, Plus, MapPin, Users, Clock, Repeat, Bell, Trash2, Pencil, Check, HelpCircle, X, Loader2, AlignLeft, CalendarDays } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import OutlookFrame, { AccountSwitch, savedAccount, saveAccount } from '@/components/mail/OutlookHeader';
import { AddressInput, useAddressBook } from '@/components/mail/Compose';
import { mail } from '@/api/mailClient';

const TZ = 'Europe/Paris';
const partsFmt = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const paris = (iso) => { const o = {}; partsFmt.formatToParts(new Date(iso)).forEach((p) => { o[p.type] = p.value; }); return { date: `${o.year}-${o.month}-${o.day}`, min: Number(o.hour) * 60 + Number(o.minute), hhmm: `${o.hour}:${o.minute}` }; };
const today = () => paris(new Date().toISOString()).date;
const noon = (d) => new Date(`${d}T12:00:00Z`);
const addD = (d, n) => { const x = noon(d); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const dow = (d) => noon(d).getUTCDay();
const monday = (d) => addD(d, -((dow(d) + 6) % 7));
const fmt = (d, o) => noon(d).toLocaleDateString('en-GB', { timeZone: 'UTC', ...o });
const hm = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const HOUR = 44;
const REMINDERS = [[0, 'None'], [5, '5 minutes'], [15, '15 minutes'], [30, '30 minutes'], [60, '1 hour'], [120, '2 hours'], [1440, '1 day'], [10080, '1 week']];
const REPEATS = [['none', 'Does not repeat'], ['daily', 'Every day'], ['weekday', 'Every weekday (Mon–Fri)'], ['weekly', 'Every week'], ['monthly', 'Every month'], ['yearly', 'Every year']];
const SHOW = [['busy', 'Busy'], ['tentative', 'Tentative'], ['free', 'Free'], ['oof', 'Away']];

const tone = (e) => {
  const s = (e.showAs || 'Busy').toLowerCase();
  const pending = e.isMeeting && /noresponse|unknown/i.test(e.myResponse || '');
  const base = s === 'free' ? 'bg-white border-[#8a8886] text-ol-text' : s === 'oof' ? 'bg-[#f1e6fb] border-[#8764b8] text-[#3b2c5e]' : 'bg-ol-sel border-ol text-[#0c3b5e]';
  return `${base} ${s === 'tentative' || pending ? 'border-dashed bg-white' : ''} ${e.cancelled ? 'line-through opacity-60' : ''}`;
};

// Split each event into per-day pieces (Paris time). Timed events crossing midnight continue next day.
function pieces(events) {
  const timed = {}; const allday = [];
  events.forEach((e) => {
    if (e.allDay) { allday.push({ e, from: e.date, to: e.endDate || e.date }); return; }
    const s = paris(e.start), en = paris(e.end);
    for (let d = s.date; d <= en.date; d = addD(d, 1)) {
      const a = d === s.date ? s.min : 0, b = d === en.date ? en.min : 1440;
      if (b > a || (a === b && d === s.date)) (timed[d] ||= []).push({ e, s: a, e2: Math.max(b, a + 15), startLabel: s.hhmm, endLabel: en.hhmm });
    }
  });
  return { timed, allday };
}
// Side-by-side lanes for overlapping events within a day.
function lanes(list) {
  const segs = [...list].sort((a, b) => a.s - b.s || b.e2 - a.e2);
  let cluster = [], ends = [];
  const flush = () => { cluster.forEach((x) => { x.n = ends.length; }); cluster = []; ends = []; };
  segs.forEach((x) => {
    if (cluster.length && x.s >= Math.max(...cluster.map((c) => c.e2))) flush();
    let i = ends.findIndex((end) => end <= x.s);
    if (i < 0) { i = ends.length; ends.push(x.e2); } else ends[i] = x.e2;
    x.lane = i; cluster.push(x);
  });
  flush();
  return segs;
}

export default function MailCalendar() {
  const qc = useQueryClient();
  const accounts = useQuery({ queryKey: ['mail', 'accounts'], queryFn: () => mail.accounts(), refetchOnWindowFocus: false, retry: false });
  const accs = accounts.data?.accounts ?? [];
  const [account, setAccount] = useState(savedAccount);
  const acc = (accs.some((a) => a.id === account) ? account : null) ?? accs[0]?.id ?? null;
  const [view, setView] = useState(() => (typeof window !== 'undefined' && window.innerWidth < 768 ? 'agenda' : 'week'));
  const [cur, setCur] = useState(today);
  const [details, setDetails] = useState(null); // event from the list
  const [editor, setEditor] = useState(null); // { mode: 'new'|'edit', ...form }
  const [notice, setNotice] = useState(null);
  const say = (t) => { setNotice(t); setTimeout(() => setNotice((n) => (n === t ? null : n)), 4000); };

  const range = useMemo(() => {
    if (view === 'day') return [cur, cur];
    if (view === 'week') { const m = monday(cur); return [m, addD(m, 6)]; }
    if (view === 'month') { const m = monday(`${cur.slice(0, 8)}01`); return [m, addD(m, 41)]; }
    return [cur, addD(cur, 30)];
  }, [view, cur]);
  const evQ = useQuery({
    queryKey: ['calendar', acc, 'view', range[0], range[1]], enabled: !!acc, refetchOnWindowFocus: true, retry: 1, keepPreviousData: true,
    queryFn: () => mail.calendar(acc, `${addD(range[0], -1)}T00:00:00Z`, `${addD(range[1], 2)}T00:00:00Z`).then((r) => r.events || []),
  });
  const events = evQ.data || [];
  const { timed, allday } = useMemo(() => pieces(events), [events]);
  const refresh = () => qc.invalidateQueries({ queryKey: ['calendar', acc] });

  const step = (n) => setCur((c) => (view === 'day' ? addD(c, n) : view === 'week' ? addD(c, 7 * n) : view === 'month' ? (() => { const d = noon(`${c.slice(0, 8)}01`); d.setUTCMonth(d.getUTCMonth() + n); return d.toISOString().slice(0, 10); })() : addD(c, 30 * n)));
  const title = view === 'month' ? fmt(cur, { month: 'long', year: 'numeric' })
    : view === 'day' ? fmt(cur, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
      : `${fmt(range[0], { day: 'numeric', month: 'short' })} – ${fmt(range[1], { day: 'numeric', month: 'short', year: 'numeric' })}`;

  const newEvent = (date = cur, min = 9 * 60, allDay = false) => setEditor({
    mode: 'new', subject: '', date, time: hm(Math.min(min, 23 * 60)), endDate: date, endTime: hm(Math.min(min + 60, 23 * 60 + 59)), allDay,
    location: '', attendees: '', optional: '', reminder: allDay ? 0 : 15, showAs: allDay ? 'free' : 'busy', repeat: 'none', until: '', body: '',
  });

  const days = view === 'day' ? [cur] : view === 'week' ? Array.from({ length: 7 }, (_, i) => addD(range[0], i)) : [];

  return (
    <OutlookFrame me={accs.find((a) => a.id === acc) || null}>
      <div className="mx-2 md:ml-0 mt-2 px-2 py-1.5 bg-white rounded-lg shadow-[0_0_2px_rgba(0,0,0,0.12),0_1px_2px_rgba(0,0,0,0.14)] flex flex-wrap items-center gap-2 shrink-0">
        <button onClick={() => newEvent()} className="inline-flex items-center gap-1.5 h-8 pl-2.5 pr-3 rounded-md bg-ol hover:bg-ol-hover text-white text-[14px] font-semibold"><Plus className="w-4 h-4" /> New event</button>
        <span className="w-px h-5 bg-ol-line mx-1" />
        <button onClick={() => setCur(today())} className="h-8 px-3 text-[13px] rounded-md border border-ol-line hover:bg-ol-bg">Today</button>
        <button onClick={() => step(-1)} className="h-8 w-8 flex items-center justify-center rounded-md border border-ol-line hover:bg-ol-bg" aria-label="Previous"><ChevronLeft className="w-4 h-4" /></button>
        <button onClick={() => step(1)} className="h-8 w-8 flex items-center justify-center rounded-md border border-ol-line hover:bg-ol-bg" aria-label="Next"><ChevronRight className="w-4 h-4" /></button>
        <h1 className="text-[16px] font-semibold text-ol-text mx-1 min-w-0 truncate">{title}</h1>
        {evQ.isFetching && <Loader2 className="w-4 h-4 animate-spin text-ol" />}
        <div className="ml-auto flex items-center gap-2 flex-wrap">
          <AccountSwitch accounts={accs} value={acc} onChange={(id) => { setAccount(id); saveAccount(id); }} />
          <div className="inline-flex p-0.5 rounded-md bg-ol-bg border border-ol-line">
            {[['day', 'Day'], ['week', 'Week'], ['month', 'Month'], ['agenda', 'Agenda']].map(([k, l]) => (
              <button key={k} onClick={() => setView(k)} className={`h-7 px-2.5 sm:px-3 text-[13px] ${view === k ? 'bg-white text-ol font-semibold shadow-sm rounded' : 'text-ol-sub hover:text-ol-text'}`}>{l}</button>
            ))}
          </div>
        </div>
      </div>
      {evQ.isError && <p className="px-6 py-2 text-[13px] text-red-600 bg-red-50 border-b border-red-200">{String(evQ.error.message)}</p>}

      <div className="flex-1 min-h-0 bg-white mx-0 md:mr-2 mt-2 md:rounded-lg md:shadow-[0_0_2px_rgba(0,0,0,0.12),0_2px_4px_rgba(0,0,0,0.14)] overflow-hidden">
        {(view === 'day' || view === 'week') && <TimeGrid days={days} timed={timed} allday={allday} onOpen={setDetails} onNew={newEvent} />}
        {view === 'month' && <MonthGrid start={range[0]} month={cur.slice(0, 7)} timed={timed} allday={allday} onOpen={setDetails} onNew={newEvent} onDay={(d) => { setCur(d); setView('day'); }} />}
        {view === 'agenda' && <Agenda from={range[0]} to={range[1]} events={events} onOpen={setDetails} />}
      </div>
      <p className="px-3 md:px-1 py-1.5 text-[12px] text-ol-sub shrink-0">Times are Paris time · {accs.find((a) => a.id === acc)?.email || ''}</p>

      {details && <EventDetails acc={acc} ev={details} onClose={() => setDetails(null)} onChanged={(t) => { refresh(); say(t); setDetails(null); }}
        onEdit={async (series) => {
          try {
            const g = await mail.calendarGet(acc, details.id, series);
            const s = paris(g.start), e = paris(g.end);
            setEditor({
              mode: 'edit', id: details.id, series, hadAttendees: g.attendees.length + g.optional.length > 0,
              subject: g.subject, date: g.allDay ? g.date : s.date, time: s.hhmm, endDate: g.allDay ? g.endDate : e.date, endTime: e.hhmm, allDay: g.allDay,
              location: g.location, attendees: g.attendees.map((x) => x.email).join(', '), optional: g.optional.map((x) => x.email).join(', '),
              reminder: g.reminder, showAs: (g.showAs || 'Busy').toLowerCase() === 'oof' ? 'oof' : (g.showAs || 'busy').toLowerCase(),
              repeat: g.recurrence?.freq || 'none', until: g.recurrence?.until || '', body: g.body,
            });
            setDetails(null);
          } catch (err) { say(err.message); }
        }} />}
      {editor && <EventEditor acc={acc} form={editor} onClose={() => setEditor(null)} onSaved={(t) => { setEditor(null); refresh(); say(t); }} />}

      {notice && <div className="fixed bottom-20 md:bottom-6 left-1/2 -translate-x-1/2 z-50 bg-[#292929] text-white text-[14px] px-4 py-2.5 rounded-lg shadow-[0_8px_16px_rgba(0,0,0,0.24)] max-w-[calc(100vw-32px)]">{notice}</div>}
    </OutlookFrame>
  );
}

function TimeGrid({ days, timed, allday, onOpen, onNew }) {
  const scroller = useRef(null);
  const [now, setNow] = useState(() => paris(new Date().toISOString()));
  useEffect(() => { if (scroller.current) scroller.current.scrollTop = 7 * HOUR; }, [days.length]);
  useEffect(() => { const t = setInterval(() => setNow(paris(new Date().toISOString())), 60000); return () => clearInterval(t); }, []);
  const tday = today();
  const top = allday.filter((a) => a.to >= days[0] && a.from <= days[days.length - 1]);
  const cols = `56px repeat(${days.length}, minmax(0, 1fr))`;
  return (
    <div className="h-full flex flex-col">
      <div className="grid border-b rule shrink-0" style={{ gridTemplateColumns: cols }}>
        <div />
        {days.map((d) => (
          <div key={d} className={`px-2 py-1.5 border-l rule text-center ${d === tday ? 'text-ol' : ''}`}>
            <div className="text-[11px] uppercase tracking-wide text-neutral-500">{fmt(d, { weekday: 'short' })}</div>
            <div className={`text-[18px] font-semibold leading-tight ${d === tday ? 'text-ol' : ''}`}>{fmt(d, { day: 'numeric' })}</div>
          </div>
        ))}
        {top.length > 0 && <>
          <div className="text-[10px] text-neutral-400 px-1 pt-1 border-t rule">all day</div>
          {days.map((d) => (
            <div key={d} className="border-l border-t rule p-0.5 space-y-0.5 min-w-0">
              {top.filter((a) => a.from <= d && a.to >= d).map((a) => (
                <button key={a.e.id} onClick={() => onOpen(a.e)} className={`block w-full text-left truncate text-[11px] px-1.5 py-0.5 border-l-2 ${tone(a.e)}`}>{a.e.subject}</button>
              ))}
            </div>
          ))}
        </>}
      </div>
      <div ref={scroller} className="flex-1 min-h-0 overflow-y-auto">
        <div className="grid relative" style={{ gridTemplateColumns: cols, height: HOUR * 24 }}>
          <div className="relative">
            {Array.from({ length: 24 }, (_, h) => <div key={h} className="absolute right-2 text-[10px] text-neutral-400 font-fig -translate-y-1/2" style={{ top: h * HOUR }}>{h ? `${String(h).padStart(2, '0')}:00` : ''}</div>)}
          </div>
          {days.map((d) => (
            <div key={d} className="relative border-l rule cursor-cell"
              onClick={(e) => { if (e.target !== e.currentTarget) return; const y = e.nativeEvent.offsetY; onNew(d, Math.floor(y / HOUR * 2) * 30); }}>
              {Array.from({ length: 24 }, (_, h) => <div key={h} className="absolute left-0 right-0 border-t border-neutral-100 pointer-events-none" style={{ top: h * HOUR }} />)}
              {lanes(timed[d] || []).map((x) => {
                const h = Math.max(18, (x.e2 - x.s) * HOUR / 60 - 2);
                return (
                  <button key={`${x.e.id}-${d}`} onClick={() => onOpen(x.e)} title={`${x.startLabel}–${x.endLabel} ${x.e.subject}`}
                    className={`absolute text-left overflow-hidden border-l-[3px] px-1.5 py-0.5 hover:brightness-95 ${tone(x.e)}`}
                    style={{ top: x.s * HOUR / 60 + 1, height: h, left: `calc(${(x.lane / x.n) * 100}% + 2px)`, width: `calc(${100 / x.n}% - 4px)` }}>
                    <div className="text-[11.5px] font-semibold leading-tight truncate">{x.e.subject}</div>
                    {h > 30 && <div className="text-[10.5px] leading-tight truncate opacity-80">{x.startLabel}–{x.endLabel}{x.e.location ? ` · ${x.e.location}` : ''}</div>}
                  </button>
                );
              })}
              {d === tday && <div className="absolute left-0 right-0 border-t-2 border-red-500 pointer-events-none z-10" style={{ top: now.min * HOUR / 60 }}><span className="absolute -left-1 -top-[5px] w-2 h-2 rounded-full bg-red-500" /></div>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function MonthGrid({ start, month, timed, allday, onOpen, onNew, onDay }) {
  const tday = today();
  const cells = Array.from({ length: 42 }, (_, i) => addD(start, i));
  const dayItems = (d) => [
    ...allday.filter((a) => a.from <= d && a.to >= d).map((a) => ({ e: a.e, label: a.e.subject, all: true })),
    ...(timed[d] || []).sort((a, b) => a.s - b.s).map((x) => ({ e: x.e, label: `${x.startLabel} ${x.e.subject}` })),
  ];
  return (
    <div className="h-full flex flex-col">
      <div className="grid grid-cols-7 border-b rule shrink-0">
        {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => <div key={d} className="px-2 py-1.5 text-[11px] uppercase tracking-wide text-neutral-500 border-l rule first:border-l-0">{d}</div>)}
      </div>
      <div className="flex-1 min-h-0 grid grid-cols-7 grid-rows-6">
        {cells.map((d) => {
          const items = dayItems(d); const max = 3;
          return (
            <div key={d} onClick={(e) => { if (e.target === e.currentTarget) onNew(d, 9 * 60); }}
              className={`border-l border-b rule p-1 min-w-0 overflow-hidden cursor-cell [&:nth-child(7n+1)]:border-l-0 ${d.slice(0, 7) !== month ? 'bg-neutral-50/70' : ''}`}>
              <button onClick={() => onDay(d)} className={`text-[12px] w-6 h-6 inline-flex items-center justify-center rounded-full ${d === tday ? 'bg-ol text-white font-semibold' : d.slice(0, 7) !== month ? 'text-neutral-400' : 'text-neutral-700 hover:bg-neutral-100'}`}>{Number(d.slice(8))}</button>
              <div className="space-y-0.5">
                {items.slice(0, max).map((it, i) => (
                  <button key={`${it.e.id}-${i}`} onClick={() => onOpen(it.e)} className={`block w-full text-left truncate text-[11px] px-1 py-px ${it.all ? `border-l-2 ${tone(it.e)}` : 'hover:bg-neutral-100'} ${it.e.cancelled ? 'line-through text-neutral-400' : ''}`}>{it.label}</button>
                ))}
                {items.length > max && <button onClick={() => onDay(d)} className="text-[11px] text-neutral-500 hover:text-neutral-900 px-1">+{items.length - max} more</button>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Agenda({ from, to, events, onOpen }) {
  const byDay = {};
  events.forEach((e) => {
    const s = e.allDay ? e.date : paris(e.start).date; const last = e.allDay ? (e.endDate || e.date) : paris(e.end).date;
    for (let d = s < from ? from : s; d <= last && d <= to; d = addD(d, 1)) (byDay[d] ||= []).push(e);
  });
  const list = Object.keys(byDay).sort();
  const tday = today();
  if (!list.length) return <p className="px-6 py-12 text-center text-[13px] text-neutral-400">Nothing in the next 30 days.</p>;
  return (
    <div className="h-full overflow-y-auto">
      {list.map((d) => (
        <section key={d} className="border-b rule">
          <h3 className={`px-4 md:px-6 py-2 text-[12px] font-semibold uppercase tracking-wide bg-neutral-50 ${d === tday ? 'text-ol' : 'text-neutral-600'}`}>{d === tday ? 'Today · ' : ''}{fmt(d, { weekday: 'long', day: 'numeric', month: 'long' })}</h3>
          {byDay[d].sort((a, b) => (a.allDay ? -1 : b.allDay ? 1 : a.start.localeCompare(b.start))).map((e) => (
            <button key={e.id + d} onClick={() => onOpen(e)} className="w-full text-left px-4 md:px-6 py-2.5 flex gap-3 hover:bg-neutral-50 border-t border-neutral-100 first:border-t-0">
              <span className="w-24 shrink-0 text-[12px] text-neutral-500 font-fig pt-0.5">{e.allDay ? 'All day' : `${paris(e.start).hhmm}–${paris(e.end).hhmm}`}</span>
              <span className={`w-1 self-stretch shrink-0 border-l-[3px] ${tone(e)}`} />
              <span className="min-w-0">
                <span className={`block text-[13.5px] font-medium truncate ${e.cancelled ? 'line-through text-neutral-400' : ''}`}>{e.subject}</span>
                {(e.location || (e.isMeeting && e.organizer)) && <span className="block text-[12px] text-neutral-500 truncate">{[e.location, e.isMeeting && e.myResponse !== 'Organizer' ? `from ${e.organizer}` : ''].filter(Boolean).join(' · ')}</span>}
              </span>
            </button>
          ))}
        </section>
      ))}
    </div>
  );
}

const RESP = { Accept: ['Accepted', 'text-emerald-700'], Tentative: ['Tentative', 'text-amber-700'], Decline: ['Declined', 'text-red-700'], NoResponseReceived: ['No answer yet', 'text-neutral-500'], Organizer: ['Organiser', 'text-neutral-900'], Unknown: ['', ''] };

function EventDetails({ acc, ev, onClose, onChanged, onEdit }) {
  const q = useQuery({ queryKey: ['calendar', acc, 'item', ev.id], queryFn: () => mail.calendarGet(acc, ev.id), retry: false });
  const g = q.data;
  const [busy, setBusy] = useState(null);
  const [ask, setAsk] = useState(null); // 'edit' | 'delete' for a repeating event
  const repeating = /Occurrence|Exception/.test(ev.kind || g?.kind || '');
  const organiser = !g?.isMeeting || g?.myResponse === 'Organizer';
  const invited = g?.isMeeting && g?.myResponse !== 'Organizer';
  const people = g ? [...g.attendees, ...g.optional.map((x) => ({ ...x, optional: true }))] : [];
  const doit = async (key, fn, msg) => { setBusy(key); try { await fn(); onChanged(msg); } catch (e) { alert(e.message); setBusy(null); } };
  const remove = (series) => {
    const notify = organiser && people.length > 0;
    if (!confirm(notify ? `Cancel this meeting${series ? ' series' : ''}? The ${people.length} attendee${people.length === 1 ? '' : 's'} will get a cancellation.` : `Delete ${series ? 'every event in this series' : 'this event'}?`)) return;
    doit('delete', () => mail.calendarDelete(acc, ev.id, { series, notify }), notify ? 'Meeting cancelled.' : 'Deleted.');
  };
  const s = paris(ev.start), e = paris(ev.end);
  const when = ev.allDay
    ? (ev.endDate && ev.endDate !== ev.date ? `${fmt(ev.date, { weekday: 'short', day: 'numeric', month: 'short' })} – ${fmt(ev.endDate, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })} · all day` : `${fmt(ev.date, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })} · all day`)
    : `${fmt(s.date, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })} · ${s.hhmm}–${e.hhmm}${e.date !== s.date ? ` (${fmt(e.date, { day: 'numeric', month: 'short' })})` : ''}`;
  const row = 'flex gap-3 text-[13px]';
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg rounded-lg p-0 gap-0 max-h-[90dvh] flex flex-col">
        <DialogHeader className="px-5 pt-5 pb-3 border-b rule">
          <DialogTitle className={`text-[17px] pr-6 ${ev.cancelled ? 'line-through' : ''}`}>{ev.subject}</DialogTitle>
          {ev.cancelled && <p className="text-[12px] text-red-700">This event was cancelled.</p>}
        </DialogHeader>
        <div className="px-5 py-4 space-y-3 overflow-y-auto">
          <div className={row}><Clock className="w-4 h-4 text-neutral-400 shrink-0 mt-0.5" /><span>{when}</span></div>
          {repeating && <div className={row}><Repeat className="w-4 h-4 text-neutral-400 shrink-0 mt-0.5" /><span>Part of a repeating series{ev.kind === 'Exception' ? ' (this one was changed)' : ''}</span></div>}
          {ev.location && <div className={row}><MapPin className="w-4 h-4 text-neutral-400 shrink-0 mt-0.5" /><span>{ev.location}</span></div>}
          {q.isLoading && <p className="text-[12px] text-neutral-400">Loading details…</p>}
          {g && invited && <div className={row}><Users className="w-4 h-4 text-neutral-400 shrink-0 mt-0.5" /><span>Invitation from <b>{g.organizer.name || g.organizer.email}</b> · your answer: <span className={RESP[g.myResponse]?.[1]}>{RESP[g.myResponse]?.[0] || g.myResponse}</span></span></div>}
          {g && people.length > 0 && (
            <div className={row}><Users className="w-4 h-4 text-neutral-400 shrink-0 mt-0.5" />
              <ul className="space-y-0.5 min-w-0">
                {people.map((p) => <li key={p.email} className="truncate">{p.name || p.email}{p.optional ? <span className="text-neutral-400"> (optional)</span> : ''} <span className={`text-[12px] ${RESP[p.response]?.[1] || ''}`}>{RESP[p.response]?.[0] || ''}</span></li>)}
              </ul>
            </div>
          )}
          {g?.reminder > 0 && <div className={row}><Bell className="w-4 h-4 text-neutral-400 shrink-0 mt-0.5" /><span>Reminder {REMINDERS.find(([m]) => m === g.reminder)?.[1] || `${g.reminder} minutes`} before</span></div>}
          {g?.body?.trim() && <div className={row}><AlignLeft className="w-4 h-4 text-neutral-400 shrink-0 mt-0.5" /><p className="whitespace-pre-wrap break-words text-neutral-700 max-h-60 overflow-y-auto">{g.body.trim()}</p></div>}
        </div>

        {ask && (
          <div className="px-5 py-3 border-t rule bg-neutral-50 flex flex-wrap items-center gap-2">
            <span className="text-[13px] mr-auto">{ask === 'edit' ? 'Edit' : 'Delete'}:</span>
            <button onClick={() => (ask === 'edit' ? onEdit(false) : remove(false))} className="h-8 px-3 text-[12px] rounded-md border border-ol-line bg-white hover:bg-ol-bg">Just this one</button>
            <button onClick={() => (ask === 'edit' ? onEdit(true) : remove(true))} className="h-8 px-3 text-[12px] rounded-md border border-ol-line bg-white hover:bg-ol-bg">The whole series</button>
            <button onClick={() => setAsk(null)} className="h-8 px-2 text-neutral-500" aria-label="Cancel"><X className="w-4 h-4" /></button>
          </div>
        )}
        <div className="px-5 py-3 border-t rule flex flex-wrap items-center gap-2">
          {g && invited && !ev.cancelled && <>
            <button disabled={!!busy} onClick={() => doit('accept', () => mail.calendarRespond(acc, ev.id, 'accept'), 'Accepted — the organiser has been told.')} className={`h-8 px-3 rounded-md text-[13px] border inline-flex items-center gap-1.5 ${g.myResponse === 'Accept' ? 'bg-emerald-700 text-white border-emerald-700' : 'border-ol-line hover:bg-ol-bg'}`}>{busy === 'accept' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />} Accept</button>
            <button disabled={!!busy} onClick={() => doit('tentative', () => mail.calendarRespond(acc, ev.id, 'tentative'), 'Answered tentative.')} className={`h-8 px-3 rounded-md text-[13px] border inline-flex items-center gap-1.5 ${g.myResponse === 'Tentative' ? 'bg-amber-600 text-white border-amber-600' : 'border-ol-line hover:bg-ol-bg'}`}><HelpCircle className="w-3.5 h-3.5" /> Tentative</button>
            <button disabled={!!busy} onClick={() => { if (confirm('Decline this invitation? It is removed from the calendar and the organiser is told.')) doit('decline', () => mail.calendarRespond(acc, ev.id, 'decline'), 'Declined.'); }} className="h-8 px-3 text-[12px] rounded-md border border-ol-line hover:bg-ol-bg inline-flex items-center gap-1.5"><X className="w-3.5 h-3.5" /> Decline</button>
          </>}
          <span className="ml-auto" />
          {g && organiser && !ev.cancelled && <button onClick={() => (repeating ? setAsk('edit') : onEdit(false))} className="h-8 px-3 text-[12px] rounded-md border border-ol-line hover:bg-ol-bg inline-flex items-center gap-1.5"><Pencil className="w-3.5 h-3.5" /> Edit</button>}
          {g && (organiser || ev.cancelled) && <button disabled={!!busy} onClick={() => (repeating ? setAsk('delete') : remove(false))} className="h-8 px-3 text-[12px] border border-red-200 text-red-700 hover:bg-red-50 inline-flex items-center gap-1.5">{busy === 'delete' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />} {organiser && people.length ? 'Cancel meeting' : 'Delete'}</button>}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function EventEditor({ acc, form, onClose, onSaved }) {
  const [f, setF] = useState(form);
  const [err, setErr] = useState(null);
  const [saving, setSaving] = useState(false);
  const [showOptional, setShowOptional] = useState(!!form.optional);
  const contacts = useAddressBook(acc, true);
  const set = (k) => (v) => setF((x) => ({ ...x, [k]: v && v.target ? (v.target.type === 'checkbox' ? v.target.checked : v.target.value) : v }));
  const recurring = f.mode === 'new' || f.series;
  const invites = [f.attendees, f.optional].join(',').split(',').map((x) => x.trim()).filter((x) => x.includes('@')).length;

  const save = async () => {
    if (!f.subject.trim()) return setErr('Give the event a title.');
    if (!f.allDay && `${f.endDate || f.date}T${f.endTime}` <= `${f.date}T${f.time}`) return setErr('The end must be after the start.');
    if (f.allDay && (f.endDate || f.date) < f.date) return setErr('The last day must be on or after the first day.');
    setErr(null); setSaving(true);
    const p = {
      subject: f.subject.trim(), body: f.body, date: f.date, time: f.allDay ? undefined : f.time, endDate: f.endDate || f.date, endTime: f.allDay ? undefined : f.endTime,
      location: f.location.trim(), attendees: f.attendees, optional: f.optional, reminderMinutes: Number(f.reminder), showAs: f.showAs,
      ...(recurring ? { recurrence: { freq: f.repeat, until: f.repeat !== 'none' ? f.until || undefined : undefined } } : {}),
      hadAttendees: f.hadAttendees, category: null,
    };
    try {
      if (f.mode === 'new') await mail.calendarCreate(acc, p);
      else await mail.calendarUpdate(acc, f.id, p, !!f.series);
      onSaved(f.mode === 'new' ? (invites ? `Event created — ${invites} invitation${invites === 1 ? '' : 's'} sent.` : 'Event created.') : (invites || f.hadAttendees ? 'Saved — attendees have been sent the update.' : 'Saved.'));
    } catch (e) { setErr(e.message); setSaving(false); }
  };

  const label = 'text-[13px] font-semibold text-ol-text mb-1 block';
  const input = 'h-9 w-full rounded-md border border-[#d1d1d1] px-2.5 text-[13px] bg-white focus:outline-none focus:border-ol';
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-xl rounded-lg p-0 gap-0 max-h-[94dvh] flex flex-col">
        <DialogHeader className="px-5 pt-5 pb-3 border-b rule">
          <DialogTitle className="text-[16px]">{f.mode === 'new' ? 'New event' : f.series ? 'Edit the whole series' : 'Edit event'}</DialogTitle>
        </DialogHeader>
        <div className="px-5 py-4 space-y-4 overflow-y-auto">
          <input autoFocus value={f.subject} onChange={set('subject')} placeholder="Add a title" className="w-full text-[17px] font-medium border-0 border-b border-neutral-300 pb-1.5 focus:outline-none focus:border-ol bg-transparent" />
          <div className="grid grid-cols-2 gap-3">
            <div><span className={label}>{f.allDay ? 'First day' : 'Start'}</span>
              <div className="flex gap-1.5"><input type="date" value={f.date} onChange={(e) => { const d = e.target.value; setF((x) => ({ ...x, date: d, endDate: !x.endDate || x.endDate < d ? d : x.endDate })); }} className={input} />{!f.allDay && <input type="time" value={f.time} onChange={set('time')} className={`${input} w-28`} />}</div></div>
            <div><span className={label}>{f.allDay ? 'Last day' : 'End'}</span>
              <div className="flex gap-1.5"><input type="date" value={f.endDate || f.date} onChange={set('endDate')} className={input} />{!f.allDay && <input type="time" value={f.endTime} onChange={set('endTime')} className={`${input} w-28`} />}</div></div>
          </div>
          <label className="flex items-center gap-2 text-[13px]"><input type="checkbox" checked={f.allDay} onChange={set('allDay')} className="accent-[#0f6cbd]" /> All day</label>
          <div><span className={label}>Invite people</span>
            <div className="rounded-md border border-[#d1d1d1] px-2.5 focus-within:border-ol"><AddressInput value={f.attendees} onChange={set('attendees')} contacts={contacts} placeholder="Names or email addresses"  /></div>
            {showOptional ? <div className="mt-1 rounded-md border border-[#d1d1d1] px-2.5 focus-within:border-ol"><AddressInput value={f.optional} onChange={set('optional')} contacts={contacts} placeholder="Optional attendees"  /></div>
              : <button type="button" onClick={() => setShowOptional(true)} className="mt-1 text-[12px] text-neutral-500 hover:text-neutral-900">+ Optional attendees</button>}
            {invites > 0 && <p className="mt-1 text-[12px] text-amber-700">{f.mode === 'new' ? 'Saving sends' : 'Saving sends an update to'} {invites} invitation{invites === 1 ? '' : 's'} from {acc}@ — as Outlook does.</p>}
          </div>
          <div><span className={label}>Location</span><input value={f.location} onChange={set('location')} placeholder="Address, room or call link" className={input} /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><span className={label}>Reminder</span><select value={f.reminder} onChange={set('reminder')} className={input}>{REMINDERS.map(([m, l]) => <option key={m} value={m}>{l}</option>)}</select></div>
            <div><span className={label}>Show as</span><select value={f.showAs} onChange={set('showAs')} className={input}>{SHOW.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
          </div>
          {recurring && (
            <div className="grid grid-cols-2 gap-3">
              <div><span className={label}>Repeat</span><select value={f.repeat} onChange={set('repeat')} className={input}>{REPEATS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
              {f.repeat !== 'none' && <div><span className={label}>Until (optional)</span><input type="date" value={f.until} min={f.date} onChange={set('until')} className={input} /></div>}
            </div>
          )}
          <div><span className={label}>Notes</span><textarea value={f.body} onChange={set('body')} rows={4} className="w-full rounded-md border border-[#d1d1d1] px-2.5 py-2 text-[13px] focus:outline-none focus:border-ol" /></div>
        </div>
        <div className="px-5 py-3 border-t rule flex items-center gap-3">
          <button onClick={save} disabled={saving} className="h-9 px-4 rounded-md bg-ol hover:bg-ol-hover text-white text-[14px] font-semibold inline-flex items-center gap-2 disabled:opacity-50">{saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <CalendarDays className="w-4 h-4" />} {invites && f.mode === 'new' ? 'Send' : 'Save'}</button>
          {err && <span className="text-[12px] text-red-600">{err}</span>}
          <button onClick={onClose} className="ml-auto h-9 px-3 text-[13px] text-neutral-500 hover:text-neutral-900">Cancel</button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

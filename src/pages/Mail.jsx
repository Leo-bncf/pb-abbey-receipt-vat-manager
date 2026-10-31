/* Hallmark · genre: modern-minimal · macrostructure: Outlook 3-pane (folders | list | reader) · theme: ledger-swiss
 * Real IONOS mail client, Outlook-style: the whole folder tree (favourites, subfolders,
 * unread counts), move mail to any folder (Move to… or drag onto a folder), select
 * several messages, flag / unread, create / rename / delete folders, older mail on
 * demand, plus read / compose / reply / forward (SMTP) and search.
 * Also: Unread / Flagged filters, right-click menu, keyboard shortcuts (? lists them),
 * 10-second "Undo" after Send, attachment preview, print, junk / not junk, and a
 * check for new mail every minute (count in the tab title).
 * Email HTML renders in a sandboxed iframe (no scripts). On phones the three panes
 * show one at a time (folders → list → message) with back buttons. */
import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { RefreshCw, Paperclip, Download, Mail as MailIcon, AlertCircle, PenSquare, Reply, ReplyAll, Forward, X, Archive, Trash2, Search, Undo2, PenLine, Loader2, Flag, FolderInput, MailOpen, Mail as MailClosed, ArrowLeft, PanelLeft, Printer, ChevronRight, MessagesSquare, ShieldAlert, ShieldCheck, AlertTriangle, Keyboard, Eye, Plane } from 'lucide-react';
import { ContextMenu, ContextMenuTrigger, ContextMenuContent, ContextMenuItem, ContextMenuSeparator } from '@/components/ui/context-menu';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import Compose from '@/components/mail/Compose';
import FolderTree, { pickFavourites } from '@/components/mail/FolderTree';
import MovePicker from '@/components/mail/MovePicker';
import { mail } from '@/api/mailClient';
import OutlookFrame, { savedAccount, saveAccount, Avatar, BarSearch, BarButton } from '@/components/mail/OutlookHeader';
import AutoReplies from '@/components/mail/AutoReplies';
import OfflineBar from '@/components/mail/OfflineBar';
import { addToOutbox } from '@/lib/offlineMail';
import { askText } from '@/components/AskText';

const fmtDate = (d) => {
  if (!d) return '';
  const dt = new Date(d);
  if (isNaN(dt)) return d;
  const today = new Date();
  return dt.toDateString() === today.toDateString()
    ? dt.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
    : dt.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' });
};
const fmtBytes = (n) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const displayName = (from) => {
  if (!from) return '(unknown)';
  const m = from.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>/);
  return (m && m[1].trim()) || (m && m[2]) || from;
};
// "Name <a@b>, c@d" -> ["a@b","c@d"]
const parseAddrs = (s) => (s || '').split(',').map((p) => {
  const m = p.match(/<([^>]+)>/);
  return (m ? m[1] : p).trim();
}).filter(Boolean);
const stripHtml = (h) => (h || '').replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ').replace(/\s+\n/g, '\n').replace(/[ \t]{2,}/g, ' ').trim();
const PAGE = 50;

const RB = ({ icon: Icon, label, title, onClick, disabled, danger, on, wide }) => (
  <button type="button" onClick={onClick} disabled={disabled} title={title || label} aria-label={title || label}
    className={`h-8 shrink-0 inline-flex items-center gap-1.5 rounded-md px-2 text-[13px] disabled:opacity-40 disabled:pointer-events-none ${on ? 'bg-ol-sel text-ol' : danger ? 'text-[#424242] hover:bg-red-50 hover:text-red-700' : 'text-[#424242] hover:bg-ol-bg'}`}>
    <Icon className="w-[18px] h-[18px]" strokeWidth={1.6} /><span className={wide ? 'hidden sm:inline' : 'hidden xl:inline'}>{label}</span>
  </button>
);
const Sep = () => <span className="w-px h-5 bg-ol-line mx-1 shrink-0" />;

// The email itself: a sandboxed frame (no scripts, no forms) that grows to the
// message's height so the whole reading pane scrolls as one, like Outlook.
function MessageFrame({ html }) {
  const ref = useRef(null);
  const [h, setH] = useState(240);
  useEffect(() => {
    const f = ref.current; if (!f) return undefined;
    let ro;
    const fit = () => { try { const d = f.contentDocument; if (d?.body) setH(Math.max(80, d.documentElement.scrollHeight + 2)); } catch { /* not readable */ } };
    const onLoad = () => {
      fit();
      try { ro = new ResizeObserver(fit); ro.observe(f.contentDocument.body); f.contentDocument.querySelectorAll('img').forEach((i) => i.addEventListener('load', fit)); } catch { /* */ }
    };
    f.addEventListener('load', onLoad);
    return () => { f.removeEventListener('load', onLoad); ro?.disconnect(); };
  }, [html]);
  return (
    <iframe ref={ref} title="message" sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox" style={{ height: h }} className="w-full border-0 block"
      srcDoc={`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><base target="_blank"><style>html,body{overflow-y:hidden}body{font-family:'Segoe UI',-apple-system,BlinkMacSystemFont,Roboto,sans-serif;color:#242424;font-size:14px;line-height:1.5;padding:8px 20px 16px;margin:0;word-wrap:break-word;overflow-x:auto} img{max-width:100%;height:auto;} table{max-width:100%;} a{color:#0f6cbd;}</style></head><body>${html}</body></html>`} />
  );
}


// Conversations: messages whose subjects match once "Re:", "Fwd:", "TR:" ... are removed.
const PREFIX_RE = /^\s*((re|fw|fwd|tr|aw|wg|sv|vs|rif|ref)\s*(\[\d+\])?\s*:\s*)+/i;
const convKey = (subject) => { const k = String(subject || '').replace(PREFIX_RE, '').replace(/\s+/g, ' ').trim().toLowerCase(); return k && k !== '(no subject)' ? k : ''; };

// One message of the reading pane. Collapsed: a one-line header (click to open it);
// open: the full message, loaded on demand (shares the cache with the list).
function ConvCard({ account, item, open, onToggle, collapsible, tag, isDraft, act }) {
  const q = useQuery({ queryKey: ['mail', 'message', account, item.box, item.uid], queryFn: () => mail.message(item.uid, account, item.box), enabled: open, refetchOnWindowFocus: false, retry: false });
  const d = q.data;
  const name = displayName(item.from || d?.from);
  const date = item.date || d?.date;
  const card = 'mt-2 bg-white md:rounded-lg md:shadow-[0_0_2px_rgba(0,0,0,0.12),0_2px_4px_rgba(0,0,0,0.14)]';
  const tagEl = tag && <span className="shrink-0 h-5 px-2 rounded-full bg-ol-bg text-[11px] text-ol-sub inline-flex items-center">{tag}</span>;
  if (!open) {
    return (
      <button onClick={onToggle} className={`${card} w-full text-left px-4 md:px-5 py-3 flex items-center gap-3 hover:bg-ol-hover2`}>
        <Avatar name={name} size={32} />
        <span className={`flex-1 min-w-0 truncate text-[14px] text-ol-text ${item.seen === false ? 'font-semibold' : ''}`}>{name}</span>
        {tagEl}
        {item.attach && <Paperclip className="w-3.5 h-3.5 text-ol-sub shrink-0" />}
        <span className="shrink-0 text-[12px] text-ol-sub whitespace-nowrap">{date ? new Date(date).toLocaleString('en-GB', { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : ''}</span>
      </button>
    );
  }
  const iconBtn = 'w-8 h-8 rounded-md flex items-center justify-center text-ol hover:bg-ol-bg';
  return (
    <article className={card}>
      <div className={`px-4 md:px-5 pt-4 flex items-start gap-3 ${collapsible ? 'cursor-pointer' : ''}`} onClick={(e) => { if (collapsible && !e.target.closest('button')) onToggle(); }}>
        <Avatar name={name} size={40} />
        <div className="flex-1 min-w-0">
          <div className="flex items-start gap-2">
            <div className="flex-1 min-w-0">
              <div className="text-[14px] text-ol-text break-words"><span className="font-semibold">{name}</span> <span className="text-ol-sub">&lt;{parseAddrs(item.from || d?.from)[0] || ''}&gt;</span> {tagEl}</div>
              {d?.to && <div className="text-[13px] text-ol-sub break-words mt-0.5">To: {d.to}</div>}
              {d?.cc && <div className="text-[13px] text-ol-sub break-words">Cc: {d.cc}</div>}
            </div>
            <div className="shrink-0 flex flex-col items-end gap-1">
              {d && <div className="flex items-center">
                {isDraft ? (
                  <button onClick={() => act.compose('draft', d, item)} className="h-8 px-3 rounded-md bg-ol hover:bg-ol-hover text-white text-[13px] font-semibold inline-flex items-center gap-1.5"><PenLine className="w-4 h-4" /> Edit draft</button>
                ) : (<>
                  <button onClick={() => act.compose('reply', d, item)} title="Reply" aria-label="Reply" className={iconBtn}><Reply className="w-[18px] h-[18px]" strokeWidth={1.6} /></button>
                  <button onClick={() => act.compose('replyall', d, item)} title="Reply all" aria-label="Reply all" className={iconBtn}><ReplyAll className="w-[18px] h-[18px]" strokeWidth={1.6} /></button>
                  <button onClick={() => act.compose('forward', d, item)} title="Forward" aria-label="Forward" className={iconBtn}><Forward className="w-[18px] h-[18px]" strokeWidth={1.6} /></button>
                </>)}
                <button onClick={() => act.print(d)} title="Print" aria-label="Print" className="hidden sm:flex w-8 h-8 rounded-md items-center justify-center text-ol-sub hover:bg-ol-bg"><Printer className="w-[18px] h-[18px]" strokeWidth={1.6} /></button>
              </div>}
              {date && <span className="text-[12px] text-ol-sub whitespace-nowrap">{new Date(date).toLocaleString('en-GB', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>}
            </div>
          </div>
        </div>
      </div>
      {q.isLoading && <div className="px-5 py-8 flex items-center justify-center text-[13px] text-ol-sub"><Loader2 className="w-5 h-5 animate-spin mr-2 text-ol" /> Loading message…</div>}
      {q.isError && !d && <div className="px-5 py-6 text-[13px] text-red-600">{String(q.error.message)}</div>}
      {d && <>
        {d.important && <div className="mx-4 md:mx-5 mt-3 px-3 py-1.5 rounded-md bg-ol-bg text-[13px] text-ol-text inline-flex items-center gap-1.5"><AlertTriangle className="w-3.5 h-3.5 text-[#c50f1f]" /> This message was sent with High importance.</div>}
        {d.attachments?.some((a) => !a.inline) && (
          <div className="px-4 md:px-5 mt-3 flex flex-wrap gap-2">
            {d.attachments.map((a, i) => (a.inline ? null : (
              <span key={i} className="inline-flex items-stretch rounded-md border border-ol-line bg-white max-w-full hover:shadow-[0_2px_4px_rgba(0,0,0,0.1)]">
                <button onClick={() => act.attachment(i, a, item)} className="inline-flex items-center gap-2.5 pl-2.5 pr-3 py-1.5 min-w-0 text-left" title="Open">
                  <span className={`w-8 h-8 rounded flex items-center justify-center text-[10px] font-bold text-white shrink-0 ${/\.pdf$/i.test(a.filename) ? 'bg-[#c50f1f]' : /\.(jpe?g|png|gif|webp|heic)$/i.test(a.filename) ? 'bg-[#0f6cbd]' : /\.(xlsx?|csv)$/i.test(a.filename) ? 'bg-[#107c41]' : /\.(docx?)$/i.test(a.filename) ? 'bg-[#185abd]' : 'bg-[#616161]'}`}>{(a.filename?.split('.').pop() || 'file').slice(0, 4).toUpperCase()}</span>
                  <span className="min-w-0"><span className="block text-[13px] text-ol-text max-w-[180px] truncate">{a.filename}</span><span className="block text-[12px] text-ol-sub">{fmtBytes(a.size)}</span></span>
                </button>
                <button onClick={() => act.download(i, a, item)} className="px-2 border-l border-ol-line text-ol-sub hover:bg-ol-bg hover:text-ol rounded-r-md" title="Download" aria-label={`Download ${a.filename}`}><Download className="w-4 h-4" /></button>
              </span>
            )))}
          </div>
        )}
        <div className="mt-2">
          {d.html ? <MessageFrame html={d.html} />
            : <pre className="whitespace-pre-wrap break-words px-4 md:px-5 py-4 text-[14px] leading-relaxed text-ol-text font-sans">{d.text || '(no text content)'}</pre>}
        </div>
        {!isDraft && (
          <div className="px-4 md:px-5 pb-4 pt-1 flex gap-2 flex-wrap">
            <button onClick={() => act.compose('reply', d, item)} className="h-8 px-3 rounded-md border border-ol-line text-[13px] text-ol-text hover:bg-ol-bg inline-flex items-center gap-1.5"><Reply className="w-4 h-4 text-ol" /> Reply</button>
            <button onClick={() => act.compose('replyall', d, item)} className="h-8 px-3 rounded-md border border-ol-line text-[13px] text-ol-text hover:bg-ol-bg inline-flex items-center gap-1.5"><ReplyAll className="w-4 h-4 text-ol" /> Reply all</button>
            <button onClick={() => act.compose('forward', d, item)} className="h-8 px-3 rounded-md border border-ol-line text-[13px] text-ol-text hover:bg-ol-bg inline-flex items-center gap-1.5"><Forward className="w-4 h-4 text-ol" /> Forward</button>
          </div>
        )}
      </>}
    </article>
  );
}


// One mailbox in the folder pane, folded or unfolded with its arrow on its own (like
// Outlook, both mailboxes can be open at once). Shares the folder / unread-count
// queries with the page, so nothing is loaded twice.
// Reaching the bottom of the list loads the older mail by itself (the button stays as a fallback).
function AutoMore({ busy, onMore }) {
  const ref = React.useRef(null);
  React.useEffect(() => {
    const el = ref.current; if (!el || busy) return undefined;
    const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) onMore(); }, { rootMargin: '300px' });
    io.observe(el); return () => io.disconnect();
  }, [busy, onMore]);
  return <div ref={ref} aria-hidden="true" className="h-px" />;
}

function MailboxSection({ acc, active, current, expanded, onToggle, onOpen, onDrop, onNew, onRename, onDelete }) {
  const foldersQ = useQuery({ queryKey: ['mail', 'folders', acc.id], queryFn: () => mail.folders(acc.id), enabled: expanded, refetchOnWindowFocus: false, retry: false, staleTime: 5 * 60e3 });
  const folders = foldersQ.data?.folders ?? [];
  const countsQ = useQuery({
    queryKey: ['mail', 'counts', acc.id], enabled: expanded && folders.length > 0, refetchOnWindowFocus: false, retry: false, staleTime: 2 * 60e3,
    queryFn: async () => Object.fromEntries(((await mail.counts(acc.id)).folders || []).map((f) => [f.name, { unread: f.unread || 0, total: f.total || 0 }])),
  });
  const counts = countsQ.data || {};
  const favourites = useMemo(() => pickFavourites(folders, counts), [folders, counts]);
  const inboxUnread = counts.INBOX?.unread || 0;
  return (
    <div className="mb-1">
      <button onClick={onToggle} title={acc.email} aria-expanded={expanded}
        className={`w-full flex items-center gap-1 h-9 pl-1.5 pr-3 text-[14px] font-semibold rounded-md hover:bg-ol-line/60 ${active ? 'text-ol-text' : 'text-ol-sub'}`}>
        <span className="w-7 h-8 flex items-center justify-center shrink-0"><ChevronRight className={`w-4 h-4 text-ol-sub transition-transform ${expanded ? 'rotate-90' : ''}`} /></span>
        <span className="truncate">{acc.email}</span>
        {!expanded && inboxUnread > 0 && <span className="ml-auto text-[13px] font-semibold text-ol tabular-nums">{inboxUnread}</span>}
      </button>
      {expanded && <>
        {foldersQ.isLoading && <p className="px-4 py-3 text-[13px] text-ol-sub">Loading folders…</p>}
        {foldersQ.isError && !foldersQ.data && <p className="px-4 py-3 text-[13px] text-red-600">{String(foldersQ.error.message)}</p>}
        {folders.length > 0 && (
          <FolderTree account={acc.id} folders={folders} counts={counts} current={active ? current : null} favourites={favourites}
            onOpen={onOpen} onDrop={onDrop} onNew={onNew} onRename={onRename} onDelete={(f) => onDelete(f, counts)} />
        )}
        {countsQ.isFetching && folders.length > 0 && <p className="px-4 pt-2 text-[12px] text-ol-mute">Counting unread…</p>}
      </>}
    </div>
  );
}

export default function Mail() {
  const qc = useQueryClient();
  const [account, setAccount] = useState(savedAccount);
  const [mailbox, setMailbox] = useState('INBOX');
  const [selected, setSelected] = useState(null);
  const [checked, setChecked] = useState([]);
  const [compose, setCompose] = useState(null); // null | initial values for <Compose>
  const [pane, setPane] = useState('list'); // phones: 'folders' | 'list' | 'message'
  const [moveFor, setMoveFor] = useState(null); // uids waiting for "Move to…"
  const [notice, setNotice] = useState(null); // { text, undo? }
  const [filter, setFilter] = useState(''); // '' | 'unread' | 'flagged'
  const [preview, setPreview] = useState(null); // { name, type, url }
  const [showKeys, setShowKeys] = useState(false);
  const [oofOpen, setOofOpen] = useState(false);
  const [params, setParams] = useSearchParams();
  const pendingSend = useRef(null); // { timer, payload, restore } during the 10-second undo window

  const accounts = useQuery({ queryKey: ['mail', 'accounts'], queryFn: () => mail.accounts(), refetchOnWindowFocus: false, retry: false });
  const accs = accounts.data?.accounts ?? [];
  const activeAccount = (accs.some((a) => a.id === account) ? account : null) ?? accs[0]?.id ?? null;
  const myEmail = accs.find((a) => a.id === activeAccount)?.email || '';
  const oofQ = useQuery({ queryKey: ['mail', 'oof', activeAccount], enabled: !!activeAccount, retry: false, staleTime: 5 * 60e3, queryFn: () => mail.oofGet(activeAccount) });
  const oofOn = oofQ.data && oofQ.data.state !== 'Disabled' && (oofQ.data.state === 'Enabled' || new Date(oofQ.data.end) > new Date());
  // /mail?to=someone@example.com (from People): open a new mail to them.
  // Also from the desktop app: mailto: links (?to=&cc=&subject=&body=), File → New mail
  // (?new=1) and a click on a new-mail notification (?account=office).
  useEffect(() => {
    const acc = params.get('account');
    if (acc && accs.some((a) => a.id === acc)) { setAccount(acc); saveAccount(acc); setMailbox('INBOX'); setSelected(null); params.delete('account'); setParams(params, { replace: true }); return; }
    const to = params.get('to'); const isNew = params.get('new');
    if ((to || isNew) && activeAccount) {
      const e = (x) => String(x || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>');
      const body = params.get('body');
      setCompose({ title: 'New message', to: to || '', cc: params.get('cc') || '', subject: params.get('subject') || '', ...(body ? { introHtml: `<p>${e(body)}</p><p><br></p>` } : {}) });
      ['to', 'cc', 'subject', 'body', 'new'].forEach((k) => params.delete(k)); setParams(params, { replace: true });
    }
  }, [params, activeAccount, accs.length]);

  const foldersQ = useQuery({ queryKey: ['mail', 'folders', activeAccount], queryFn: () => mail.folders(activeAccount), enabled: !!activeAccount, refetchOnWindowFocus: false, retry: false, staleTime: 5 * 60e3 });
  const folders = foldersQ.data?.folders ?? [];
  // Unread / total for every folder: slow on a big mailbox (one STATUS each), so it loads after the tree.
  const countsKey = ['mail', 'counts', activeAccount];
  const countsQ = useQuery({
    queryKey: countsKey, enabled: !!activeAccount && folders.length > 0, refetchOnWindowFocus: false, retry: false, staleTime: 2 * 60e3,
    queryFn: async () => Object.fromEntries(((await mail.counts(activeAccount)).folders || []).map((f) => [f.name, { unread: f.unread || 0, total: f.total || 0 }])),
  });
  const counts = countsQ.data || {};
  const favourites = useMemo(() => pickFavourites(folders, counts), [folders, counts]);
  const curFolder = folders.find((f) => f.name === mailbox);
  const special = mailbox === 'INBOX' ? 'inbox' : curFolder?.special || null;
  const FAV_LABEL = { inbox: 'Inbox', drafts: 'Drafts', sent: 'Sent', archive: 'Archive', trash: 'Deleted', junk: 'Junk' };
  const folderTitle = special === 'inbox' ? 'Inbox' : (special && favourites[special]?.name === mailbox ? FAV_LABEL[special] : curFolder?.label || mailbox);
  // Refresh the counts of just the folders an action touched.
  const recount = (names) => mail.countsFor(activeAccount, [...new Set(names.filter(Boolean))])
    .then((r) => qc.setQueryData(countsKey, (old) => ({ ...(old || {}), ...(r.counts || {}) }))).catch(() => {});

  const listKey = ['mail', 'list', activeAccount, mailbox, filter];
  const list = useInfiniteQuery({
    queryKey: listKey,
    queryFn: ({ pageParam = 0 }) => mail.list(activeAccount, mailbox, PAGE, pageParam, filter),
    getNextPageParam: (last, all) => (last.more ? all.reduce((n, p) => n + p.messages.length, 0) : undefined),
    enabled: !!activeAccount, refetchOnWindowFocus: false, retry: false,
  });

  // Search (subject / sender / recipient; optionally the text) in the current folder.
  const [searchInput, setSearchInput] = useState('');
  const [q, setQ] = useState('');
  const [inBody, setInBody] = useState(false);
  const searchKey = ['mail', 'search', activeAccount, mailbox, q, inBody];
  const search = useQuery({
    queryKey: searchKey, queryFn: () => mail.search(q, activeAccount, mailbox, inBody),
    enabled: !!activeAccount && q.length >= 2, refetchOnWindowFocus: false, retry: false,
  });
  const searching = q.length >= 2;
  const messages = searching ? (search.data?.messages || []) : (list.data?.pages || []).flatMap((p) => p.messages);
  const total = searching ? search.data?.matches : list.data?.pages?.[0]?.total;
  const shownLoading = searching ? search.isLoading : list.isLoading;
  const shownError = searching ? search.error : list.error;

  // Conversation view (Outlook's default): one row per conversation, newest message on top.
  const [convView, setConvView] = useState(() => { try { return localStorage.getItem('mail.conversations') !== '0'; } catch { return true; } });
  const toggleConv = () => setConvView((v) => { try { localStorage.setItem('mail.conversations', v ? '0' : '1'); } catch { /* */ } return !v; });
  const convOn = convView && special !== 'drafts';
  const rows = useMemo(() => {
    if (!convOn) return messages.map((m) => ({ key: `u${m.uid}`, head: m, items: [m] }));
    const by = new Map(); const out = [];
    messages.forEach((m) => {
      const k = convKey(m.subject) || `u${m.uid}`;
      let r = by.get(k);
      if (!r) { r = { key: k, head: m, items: [] }; by.set(k, r); out.push(r); }
      r.items.push(m);
    });
    return out;
  }, [messages, convOn]);
  const [openRows, setOpenRows] = useState(() => new Set());

  // Patch / drop messages in what's on screen (list and search) without waiting for the server.
  const patchShown = (fn) => {
    qc.setQueryData(listKey, (d) => (d ? { ...d, pages: d.pages.map((p) => ({ ...p, messages: fn(p.messages) })) } : d));
    if (searching) qc.setQueryData(searchKey, (d) => (d ? { ...d, messages: fn(d.messages) } : d));
  };
  const dropShown = (uids) => patchShown((ms) => ms.filter((m) => !uids.includes(m.uid)));

  const say = (text, ms = 4000, undo) => { const n = { text, undo }; setNotice(n); setTimeout(() => setNotice((x) => (x === n ? null : x)), ms); };

  const act = useMutation({
    mutationFn: ({ kind, uids, dest }) => {
      if (kind === 'archive') return mail.archive(uids, activeAccount, mailbox);
      if (kind === 'restore') return mail.restore(uids, activeAccount, mailbox);
      if (kind === 'delete') return mail.remove(uids, activeAccount, mailbox);
      if (kind === 'move') return mail.move(uids, activeAccount, mailbox, dest.name);
      return mail.flags(uids, activeAccount, mailbox, kind);
    },
    onMutate: ({ kind, uids }) => {
      if (['seen', 'unseen', 'flagged', 'unflagged'].includes(kind)) {
        patchShown((ms) => ms.map((m) => (uids.includes(m.uid) ? { ...m, ...(kind === 'seen' ? { seen: true } : kind === 'unseen' ? { seen: false } : { flagged: kind === 'flagged' }) } : m)));
        return;
      }
      // Leaves this folder: open the next message, drop the moved ones.
      if (selected != null && uids.includes(selected)) {
        const i = messages.findIndex((m) => m.uid === selected);
        const next = messages.slice(i + 1).find((m) => !uids.includes(m.uid)) || messages.slice(0, i).reverse().find((m) => !uids.includes(m.uid));
        setSelected(next ? next.uid : null);
        if (!next) setPane('list');
      }
      setChecked((c) => c.filter((u) => !uids.includes(u)));
      dropShown(uids);
    },
    onSuccess: (r, { kind, uids, dest }) => {
      const n = uids.length === 1 ? '1 message' : `${uids.length} messages`;
      if (kind === 'move') say(`${n} moved to ${dest.label}.`);
      else if (kind === 'archive') say(`${n} archived.`);
      else if (kind === 'delete') say(special === 'trash' ? `${n} deleted for good.` : `${n} moved to Deleted.`);
      else if (kind === 'restore') say(`${n} moved back to the Inbox.`);
      recount([mailbox, dest?.name, kind === 'archive' && favourites.archive?.name, kind === 'delete' && favourites.trash?.name, kind === 'restore' && 'INBOX']);
      if (kind === 'archive' && !favourites.archive) qc.invalidateQueries({ queryKey: ['mail', 'folders', activeAccount] });
      if (dest) qc.invalidateQueries({ queryKey: ['mail', 'list', activeAccount, dest.name] });
    },
    onError: (e) => { say(`Could not do that: ${e.message}`); qc.invalidateQueries({ queryKey: listKey }); },
  });
  const run = (kind, uids, dest) => uids.length && act.mutate({ kind, uids, dest });

  const msg = useQuery({
    queryKey: ['mail', 'message', activeAccount, mailbox, selected],
    queryFn: () => mail.message(selected, activeAccount, mailbox),
    enabled: selected != null && !!activeAccount, refetchOnWindowFocus: false, retry: false,
  });

  // Opening an unread message marks it read (any folder), and the folder's count drops by one.
  // In conversation view the whole conversation is marked read.
  useEffect(() => {
    if (!msg.data || selected == null) return;
    const row = rows.find((r) => r.items.some((x) => x.uid === selected));
    const unread = (row ? row.items : messages.filter((x) => x.uid === selected)).filter((x) => !x.seen).map((x) => x.uid);
    if (!unread.length) return;
    patchShown((ms) => ms.map((x) => (unread.includes(x.uid) ? { ...x, seen: true } : x)));
    qc.setQueryData(countsKey, (old) => (old?.[mailbox] ? { ...old, [mailbox]: { ...old[mailbox], unread: Math.max(0, old[mailbox].unread - unread.length) } } : old));
    if (unread.length === 1) mail.markread(unread[0], activeAccount, mailbox).catch(() => {});
    else mail.flags(unread, activeAccount, mailbox, 'seen').catch(() => {});
  }, [msg.data]);

  // The open conversation: its messages in this folder, plus the matching ones in Sent
  // (or in the Inbox when reading Sent), found by subject.
  const selRow = selected != null ? rows.find((r) => r.items.some((x) => x.uid === selected)) : null;
  const otherBox = special === 'sent' ? 'INBOX' : favourites.sent?.name;
  const otherLabel = special === 'sent' ? 'Inbox' : 'Sent';
  const convSubj = convOn && selRow ? convKey(selRow.head.subject) : '';
  const relatedQ = useQuery({
    queryKey: ['mail', 'related', activeAccount, otherBox, convSubj],
    enabled: !!convSubj && !!otherBox && otherBox !== mailbox, staleTime: 60e3, retry: false, refetchOnWindowFocus: false,
    queryFn: async () => {
      const core = selRow.head.subject.replace(PREFIX_RE, '').trim().slice(0, 80);
      const r = await mail.search(core, activeAccount, otherBox);
      return (r.messages || []).filter((m) => convKey(m.subject) === convSubj);
    },
  });
  const convItems = useMemo(() => {
    if (selected == null) return [];
    const here = (selRow ? selRow.items : messages.filter((m) => m.uid === selected)).map((m) => ({ ...m, box: mailbox }));
    if (!convOn) return here.filter((m) => m.uid === selected).concat(here.length ? [] : [{ uid: selected, box: mailbox }]);
    const there = (relatedQ.data || []).map((m) => ({ ...m, box: otherBox }));
    return [...here, ...there].sort((x, y) => new Date(y.date) - new Date(x.date));
  }, [selected, selRow, relatedQ.data, convOn, mailbox, otherBox, messages]);
  const [expanded, setExpanded] = useState(() => new Set());
  useEffect(() => {
    const t = new Set([`${mailbox}:${selected}`]);
    selRow?.items.forEach((m) => { if (!m.seen) t.add(`${mailbox}:${m.uid}`); });
    setExpanded(t);
  }, [selected]);

  const reset = () => { setSelected(null); setChecked([]); setQ(''); setSearchInput(''); };
  const openFolder = (name) => { setMailbox(name); reset(); setFilter(''); setPane('list'); };
  // A folder of either mailbox: switch to that mailbox if needed, then open it.
  const openIn = (accId, name) => { if (accId !== activeAccount) { setAccount(accId); saveAccount(accId); } openFolder(name); };
  const openMessage = (uid) => { setSelected(uid); setPane('message'); };
  const refresh = () => { list.refetch(); countsQ.refetch(); foldersQ.refetch(); if (searching) search.refetch(); };

  // Folders: new / rename / delete.
  const folderOp = async (fn, ok, acc = activeAccount) => {
    try { const r = await fn(); await qc.invalidateQueries({ queryKey: ['mail', 'folders', acc] }); qc.invalidateQueries({ queryKey: ['mail', 'counts', acc] }); say(ok(r)); return r; }
    catch (e) { say(`Could not do that: ${e.message}`); return null; }
  };
  const newFolder = async (parent, acc = activeAccount) => {
    const label = await askText(parent ? `New folder inside “${parent.label}”` : 'New folder name', { okLabel: 'Create' });
    if (!label?.trim()) return;
    const r = await folderOp(() => mail.createFolder(acc, parent?.name, label.trim()), () => `Folder “${label.trim()}” created.`, acc);
    if (r?.name && parent) { try { const k = `mail.open.${acc}`; const s = new Set(JSON.parse(localStorage.getItem(k) || '[]')); s.add(parent.name); localStorage.setItem(k, JSON.stringify([...s])); } catch { /* */ } }
  };
  const renameFolder = async (f, acc = activeAccount) => {
    const label = await askText('Rename folder', { defaultValue: f.label, okLabel: 'Rename' });
    if (!label?.trim() || label.trim() === f.label) return;
    const r = await folderOp(() => mail.renameFolder(acc, f.name, label.trim()), () => `Renamed to “${label.trim()}”.`, acc);
    if (r?.name && acc === activeAccount && mailbox === f.name) openFolder(r.name);
  };
  const deleteFolder = async (f, acc = activeAccount, cnt = counts) => {
    const c = cnt[f.name];
    if (!confirm(`Delete the folder “${f.label}”${c?.total ? ` and its ${c.total} message${c.total === 1 ? '' : 's'}` : ''}? It goes to Deleted with everything inside (subfolders too), so it can be brought back from there.`)) return;
    const r = await folderOp(() => mail.deleteFolder(acc, f.name), () => `Folder “${f.label}” moved to Deleted.`, acc);
    if (r && acc === activeAccount && (mailbox === f.name || mailbox.startsWith(f.name + f.delim))) openFolder('INBOX');
  };

  const sendMut = useMutation({
    mutationFn: ({ payload, acc }) => mail.send(acc, payload),
    onSuccess: () => { say('Sent.'); qc.invalidateQueries({ queryKey: ['mail', 'list', activeAccount] }); recount([favourites.sent?.name, favourites.drafts?.name]); },
    onError: (e, { payload, restore, acc }) => {
      // No connection: the mail waits on this computer and leaves by itself when the connection is back.
      if (e?.offline) { addToOutbox(acc, payload).then(() => say("You're offline. The mail will be sent when the connection is back.", 8000)); return; }
      say(`Not sent: ${e.message}`, 8000); setCompose({ ...restore, title: restore.title || 'New message' });
    },
  });
  // Outlook-style "Undo": the window closes at once, the mail leaves 10 seconds later.
  const queueSend = (payload, restore) => {
    if (pendingSend.current) { clearTimeout(pendingSend.current.timer); sendMut.mutate(pendingSend.current.job); }
    const job = { payload, restore, acc: activeAccount };
    const timer = setTimeout(() => { pendingSend.current = null; setNotice(null); sendMut.mutate(job); }, 10000);
    pendingSend.current = { timer, job };
    setCompose(null);
    say('Sending…', 10000, () => { clearTimeout(timer); pendingSend.current = null; setNotice(null); setCompose({ ...restore, title: restore.title || 'New message' }); });
  };
  // Leaving the page during the undo window: send straight away rather than lose the mail.
  useEffect(() => {
    const flush = () => { if (pendingSend.current) { clearTimeout(pendingSend.current.timer); const { payload, acc } = pendingSend.current.job; pendingSend.current = null; mail.send(acc, payload).catch(() => {}); } };
    window.addEventListener('pagehide', flush);
    return () => { window.removeEventListener('pagehide', flush); flush(); };
  }, []);

  useEffect(() => { if (compose !== null) setPane('message'); }, [compose]);
  const openCompose = (mode, m = msg.data, src = { uid: selected, box: mailbox }) => {
    if (mode === 'new' || !m) { setCompose({ title: 'New message', to: '', cc: '', subject: '' }); return; }
    if (mode === 'draft') {
      setCompose({ title: 'Draft', to: parseAddrs(m.to).join(', '), cc: parseAddrs(m.cc).join(', '), subject: m.subject === '(no subject)' ? '' : m.subject,
        bodyHtml: m.html || String(m.text || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/\n/g, '<br>'),
        draftUid: src.uid });
      return;
    }
    const reIt = (subj, p) => (new RegExp(`^${p}:`, 'i').test(subj || '') ? subj : `${p}: ${subj || ''}`);
    const when = m.date ? new Date(m.date).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
    const e = (x) => String(x || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const quote = { quoteHtml: m.html || '', quoteText: m.text || stripHtml(m.html) || '' };
    if (mode === 'reply' || mode === 'replyall') {
      let cc = '';
      if (mode === 'replyall') {
        const others = [...parseAddrs(m.to), ...parseAddrs(m.cc)].filter((x) => x.toLowerCase() !== myEmail.toLowerCase() && x.toLowerCase() !== parseAddrs(m.from)[0]?.toLowerCase());
        cc = [...new Set(others)].join(', ');
      }
      // Replying to your own message (from Sent) goes to the people it was sent to.
      const mine = parseAddrs(m.from)[0]?.toLowerCase() === myEmail.toLowerCase();
      const to = mine ? parseAddrs(m.to).join(', ') : parseAddrs(m.from)[0] || '';
      setCompose({ title: mode === 'replyall' ? 'Reply all' : 'Reply', to, cc, subject: reIt(m.subject, 'Re'),
        quoteHeader: `On ${e(when)}, ${e(m.from)} wrote:`, ...quote, inReplyTo: m.message_id || '', references: m.message_id || '' });
    } else if (mode === 'forward') {
      setCompose({ title: 'Forward', to: '', cc: '', subject: reIt(m.subject, 'Fwd'),
        quoteHeader: `---------- Forwarded message ----------<br>From: ${e(m.from)}<br>Date: ${e(when)}<br>Subject: ${e(m.subject)}<br>To: ${e(m.to)}`, ...quote,
        forwardFrom: { mailbox: src.box, uid: src.uid }, forwardAttachments: m.attachments || [] });
    }
  };

  const openMsg = messages.find((m) => m.uid === selected);
  const allChecked = messages.length > 0 && checked.length === messages.length;

  // Reply / forward from the right-click menu on a message that is not open yet.
  const pendingCompose = useRef(null);
  useEffect(() => { if (msg.data && pendingCompose.current) { const mode = pendingCompose.current; pendingCompose.current = null; openCompose(mode); } }, [msg.data]);  
  const composeFor = (uid, mode) => { if (uid === selected && msg.data) openCompose(mode); else { pendingCompose.current = mode; openMessage(uid); } };

  const junk = (uids) => (favourites.junk ? run('move', uids, favourites.junk) : say('This mailbox has no Junk folder.'));
  const notJunk = (uids) => run('move', uids, { name: 'INBOX', label: 'Inbox' });

  // Print: the message goes into a hidden frame that can be printed but runs no script.
  const printMessage = (m = msg.data) => {
    if (!m) return;
    const e = (x) => String(x || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const f = document.createElement('iframe');
    f.setAttribute('sandbox', 'allow-same-origin allow-modals');
    f.style.cssText = 'position:fixed;width:0;height:0;border:0;right:0;bottom:0';
    f.srcdoc = `<!doctype html><html><head><meta charset="utf-8"><title>${e(m.subject)}</title><style>body{font-family:Arial,sans-serif;font-size:13px;color:#111;margin:24px} .h{border-bottom:1px solid #999;padding-bottom:10px;margin-bottom:16px} .h div{margin:2px 0} img{max-width:100%}</style></head><body>
      <div class="h"><div style="font-size:17px;font-weight:bold;margin-bottom:8px">${e(m.subject)}</div><div><b>From:</b> ${e(m.from)}</div><div><b>To:</b> ${e(m.to)}</div>${m.cc ? `<div><b>Cc:</b> ${e(m.cc)}</div>` : ''}<div><b>Date:</b> ${e(m.date ? new Date(m.date).toLocaleString('en-GB') : '')}</div>${(m.attachments || []).filter((a) => !a.inline).length ? `<div><b>Attachments:</b> ${e(m.attachments.filter((a) => !a.inline).map((a) => a.filename).join(', '))}</div>` : ''}</div>
      ${m.html || `<pre style="white-space:pre-wrap;font-family:inherit">${e(m.text)}</pre>`}</body></html>`;
    f.onload = () => { setTimeout(() => { try { f.contentWindow.focus(); f.contentWindow.print(); } catch { say('Printing is blocked by this browser.'); } setTimeout(() => f.remove(), 60000); }, 300); };
    document.body.appendChild(f);
  };

  // Attachments: pictures, PDFs and text open in a viewer; anything else downloads.
  const openAttachment = async (i, a, src = { uid: selected, box: mailbox }) => {
    const t = (a.contentType || '').toLowerCase();
    const viewable = t.startsWith('image/') || t === 'application/pdf' || t === 'text/plain' || /\.(pdf|png|jpe?g|gif|webp|txt)$/i.test(a.filename || '');
    if (!viewable) { mail.downloadAttachment(src.uid, i, a.filename, activeAccount, src.box).catch((e) => say(e.message)); return; }
    try {
      const blob = await mail.attachmentBlob(src.uid, i, activeAccount, src.box);
      const type = /\.pdf$/i.test(a.filename) ? 'application/pdf' : t || blob.type;
      setPreview({ name: a.filename, type, url: URL.createObjectURL(new Blob([blob], { type })), idx: i });
    } catch (e) { say(e.message); }
  };
  const closePreview = () => { if (preview?.url) URL.revokeObjectURL(preview.url); setPreview(null); };

  // New mail: every minute (while the page is visible) recount the Inbox and this folder; reload the list when it changed.
  const lastTotals = useRef({});
  useEffect(() => {
    if (!activeAccount) return undefined;
    const tick = async () => {
      if (document.visibilityState !== 'visible') return;
      try {
        const names = [...new Set(['INBOX', mailbox])];
        const r = await mail.countsFor(activeAccount, names);
        const c = r.counts || {};
        const before = qc.getQueryData(countsKey) || {};
        qc.setQueryData(countsKey, (old) => ({ ...(old || {}), ...c }));
        if (before.INBOX && c.INBOX && c.INBOX.total > before.INBOX.total && c.INBOX.unread > before.INBOX.unread) say(`New mail in the Inbox (${c.INBOX.unread} unread).`);
        const t = c[mailbox]?.total;
        if (t != null && lastTotals.current[mailbox] != null && t !== lastTotals.current[mailbox] && !q && checked.length === 0) qc.invalidateQueries({ queryKey: ['mail', 'list', activeAccount, mailbox] });
        if (t != null) lastTotals.current[mailbox] = t;
      } catch { /* offline: try again next minute */ }
    };
    const id = setInterval(tick, 60000);
    return () => clearInterval(id);
  }, [activeAccount, mailbox, q, checked.length]);  
  const inboxUnread = counts.INBOX?.unread || 0;
  useEffect(() => {
    const before = document.title;
    document.title = inboxUnread ? `(${inboxUnread}) Mail · PB Abbey` : 'Mail · PB Abbey';
    return () => { document.title = before; };
  }, [inboxUnread]);

  // Keyboard shortcuts (Outlook-like). Ignored while typing or when a window is open.
  const searchRef = useRef(null);
  const keyState = useRef({});
  keyState.current = { rows, selected, special, openMsg: messages.find((m) => m.uid === selected), busy: compose !== null || !!moveFor || !!preview || showKeys };
  useEffect(() => {
    const onKey = (e) => {
      const t = e.target; const k = keyState.current;
      if (k.busy || e.metaKey || e.ctrlKey || e.altKey) return;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      const idx = k.rows.findIndex((r) => r.items.some((m) => m.uid === k.selected));
      const go = (d) => { const n = k.rows[idx < 0 ? 0 : Math.min(k.rows.length - 1, Math.max(0, idx + d))]?.head; if (n) { openMessage(n.uid); document.querySelector(`[data-uid="${n.uid}"]`)?.scrollIntoView({ block: 'nearest' }); } };
      const one = k.selected != null ? (k.rows.find((r) => r.items.some((m) => m.uid === k.selected))?.items.map((m) => m.uid) || [k.selected]) : [];
      const key = e.key;
      const map = {
        n: () => openCompose('new'), '/': () => searchRef.current?.focus(), '?': () => setShowKeys(true),
        j: () => go(1), ArrowDown: () => go(1), k: () => go(-1), ArrowUp: () => go(-1),
        r: () => one.length && openCompose('reply'), R: () => one.length && openCompose('replyall'), a: () => one.length && openCompose('replyall'),
        f: () => one.length && openCompose('forward'), F: () => one.length && openCompose('forward'),
        Delete: () => one.length && (k.special !== 'trash' || confirm('Delete this email for good?')) && run('delete', one),
        Backspace: () => one.length && (k.special !== 'trash' || confirm('Delete this email for good?')) && run('delete', one),
        e: () => one.length && k.special !== 'archive' && run('archive', one),
        v: () => one.length && setMoveFor(one),
        u: () => k.openMsg && run(k.openMsg.seen ? 'unseen' : 'seen', one),
        Insert: () => k.openMsg && run(k.openMsg.flagged ? 'unflagged' : 'flagged', one), g: () => k.openMsg && run(k.openMsg.flagged ? 'unflagged' : 'flagged', one),
        p: () => one.length && printMessage(),
        Escape: () => { setSelected(null); setPane('list'); },
      };
      if (map[key]) { e.preventDefault(); map[key](); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }); // re-bound each render: the handlers read fresh state

  // Ribbon actions work on the ticked messages, else on the open one.
  const targets = checked.length ? checked : selRow ? selRow.items.map((m) => m.uid) : selected != null ? [selected] : [];
  const tMsgs = messages.filter((m) => targets.includes(m.uid));
  const tUnread = tMsgs.some((m) => !m.seen);
  const tUnflagged = tMsgs.some((m) => !m.flagged);
  const del = (uids) => { if (uids.length && (special !== 'trash' || confirm(`Delete ${uids.length === 1 ? 'this email' : `${uids.length} emails`} for good? It cannot be recovered.`))) run('delete', uids); };
  const canArchive = special !== 'archive' && special !== 'trash' && special !== 'drafts';
  const one = !checked.length && selected != null && !!msg.data;
  const [ribbonTab, setRibbonTab] = useState('home');
  // Which mailboxes are unfolded in the folder pane (both by default, remembered).
  const [unfolded, setUnfolded] = useState(() => { try { const v = JSON.parse(localStorage.getItem('mail.unfolded') || 'null'); return v ? new Set(v) : null; } catch { return null; } });
  const isUnfolded = (id) => (unfolded ? unfolded.has(id) : true);
  const toggleUnfolded = (id) => setUnfolded((u0) => { const n = new Set(u0 || accs.map((a) => a.id)); n.has(id) ? n.delete(id) : n.add(id); try { localStorage.setItem('mail.unfolded', JSON.stringify([...n])); } catch { /* */ } return n; });
  // Date groups, as in Outlook's message list.
  const groupOf = (d) => {
    const dt = new Date(d); if (isNaN(dt)) return 'Older';
    const day = new Date(); day.setHours(0, 0, 0, 0);
    const diff = (day - new Date(dt.getFullYear(), dt.getMonth(), dt.getDate())) / 864e5;
    if (diff <= 0) return 'Today';
    if (diff === 1) return 'Yesterday';
    const dow = (day.getDay() + 6) % 7;
    if (diff <= dow) return 'This week';
    if (diff <= dow + 7) return 'Last week';
    if (dt.getMonth() === day.getMonth() && dt.getFullYear() === day.getFullYear()) return 'Earlier this month';
    if (dt.getFullYear() === day.getFullYear()) return dt.toLocaleDateString('en-GB', { month: 'long' });
    return dt.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
  };

  const none = targets.length === 0;

  return (
    <OutlookFrame me={myEmail ? { email: myEmail } : null}
      search={<BarSearch inputRef={searchRef} value={searchInput} onChange={setSearchInput} placeholder={`Search ${folderTitle}`}
        onSubmit={() => { setQ(searchInput.trim()); setSelected(null); setChecked([]); setPane('list'); }} onClear={() => { setSearchInput(''); setQ(''); }} />}
      actions={<>
        <BarButton title="Automatic replies (out of office)" onClick={() => setOofOpen(true)} active={oofOn}><Plane className="w-[18px] h-[18px]" /></BarButton>
        <BarButton title="Keyboard shortcuts (?)" onClick={() => setShowKeys(true)} className="hidden md:inline-flex"><Keyboard className="w-[18px] h-[18px]" /></BarButton>
      </>}>
      {/* Ribbon */}
      <div className="shrink-0 px-2 md:pl-0 md:pr-2 pt-1">
        <div className="flex items-center gap-1 h-9">
          {[['home', 'Home'], ['view', 'View'], ['help', 'Help']].map(([k, l]) => (
            <button key={k} type="button" onClick={() => setRibbonTab(k)} className={`relative h-9 px-2.5 text-[14px] ${ribbonTab === k ? 'text-ol-text font-semibold' : 'text-ol-sub hover:text-ol-text'}`}>
              {l}{ribbonTab === k && <span className="absolute left-2.5 right-2.5 bottom-1 h-[3px] rounded-full bg-ol" />}
            </button>
          ))}
          {(act.isPending || list.isFetching || countsQ.isFetching) && <Loader2 className="w-4 h-4 animate-spin text-ol-sub ml-2" aria-label="Working" />}
        </div>
        <div className="h-11 px-1.5 bg-white rounded-lg shadow-[0_0_2px_rgba(0,0,0,0.12),0_1px_2px_rgba(0,0,0,0.14)] flex items-center gap-0.5 overflow-x-auto">
          {ribbonTab === 'home' && <>
            <button type="button" onClick={() => { openCompose('new'); setPane('message'); }} className="h-8 shrink-0 pl-2.5 pr-3 rounded-md bg-ol hover:bg-ol-hover active:bg-ol-press text-white text-[14px] font-semibold inline-flex items-center gap-2">
              <PenSquare className="w-4 h-4" /> New mail
            </button>
            <Sep />
            <RB icon={Trash2} label="Delete" danger disabled={none} onClick={() => del(targets)} wide />
            {canArchive && <RB icon={Archive} label="Archive" disabled={none} onClick={() => run('archive', targets)} wide />}
            {special === 'trash' && <RB icon={Undo2} label="Restore" title="Move back to Inbox" disabled={none} onClick={() => run('restore', targets)} wide />}
            {special === 'junk' ? <RB icon={ShieldCheck} label="Not junk" disabled={none} onClick={() => notJunk(targets)} />
              : special !== 'drafts' && special !== 'sent' && <RB icon={ShieldAlert} label="Report" title="Junk" disabled={none} onClick={() => junk(targets)} />}
            <RB icon={FolderInput} label="Move to" disabled={none} onClick={() => setMoveFor(targets)} />
            <Sep />
            {special === 'drafts' ? <RB icon={PenLine} label="Edit draft" disabled={!one} onClick={() => openCompose('draft')} wide /> : <>
              <RB icon={Reply} label="Reply" disabled={!one} onClick={() => { openCompose('reply'); setPane('message'); }} />
              <RB icon={ReplyAll} label="Reply all" disabled={!one} onClick={() => { openCompose('replyall'); setPane('message'); }} />
              <RB icon={Forward} label="Forward" disabled={!one} onClick={() => { openCompose('forward'); setPane('message'); }} />
            </>}
            <Sep />
            <RB icon={tUnread ? MailOpen : MailClosed} label={tUnread ? 'Read' : 'Unread'} title={tUnread ? 'Mark as read' : 'Mark as unread'} disabled={none} onClick={() => {
              if (!tUnread && !checked.length && selected != null) { run('unseen', targets); qc.setQueryData(countsKey, (o) => (o?.[mailbox] ? { ...o, [mailbox]: { ...o[mailbox], unread: o[mailbox].unread + targets.length } } : o)); setSelected(null); setPane('list'); }
              else run(tUnread ? 'seen' : 'unseen', targets);
            }} />
            <RB icon={Flag} label={none || tUnflagged ? 'Flag' : 'Unflag'} disabled={none} onClick={() => run(tUnflagged ? 'flagged' : 'unflagged', targets)} />
            <RB icon={Printer} label="Print" disabled={!one} onClick={() => printMessage()} />
            <Sep />
            <RB icon={RefreshCw} label="Sync" title="Check for new mail" onClick={refresh} />
            <RB icon={Plane} label="Automatic replies" on={oofOn} onClick={() => setOofOpen(true)} />
          </>}
          {ribbonTab === 'view' && <>
            {[['', 'All mail', MailIcon], ['unread', 'Unread', MailClosed], ['flagged', 'Flagged', Flag]].map(([k, l, I]) => (
              <RB key={k} icon={I} label={l} on={filter === k} onClick={() => { setFilter(k); setSelected(null); setChecked([]); }} wide />
            ))}
            <Sep />
            <RB icon={MessagesSquare} label="Conversations" title="Group messages into conversations" on={convView} onClick={toggleConv} wide />
            <Sep />
            <RB icon={Search} label="Search the message text too" on={inBody} onClick={() => setInBody((v) => !v)} wide />
            <RB icon={RefreshCw} label="Sync" onClick={refresh} wide />
          </>}
          {ribbonTab === 'help' && <>
            <RB icon={Keyboard} label="Keyboard shortcuts" onClick={() => setShowKeys(true)} wide />
            <RB icon={Plane} label="Automatic replies" on={oofOn} onClick={() => setOofOpen(true)} wide />
          </>}
        </div>
      </div>

      {oofOn && (
        <div className="mx-2 md:ml-0 mt-2 px-3 py-2 rounded-lg bg-[#fff9f5] border border-[#fdcfb4] text-[13px] text-[#8a3707] flex items-center gap-3 shrink-0">
          <Plane className="w-4 h-4 shrink-0" />
          <span className="min-w-0 truncate">Automatic replies are on for {myEmail}{oofQ.data.state === 'Scheduled' ? ` until ${new Date(oofQ.data.end).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}` : ''}.</span>
          <button onClick={() => setOofOpen(true)} className="ml-auto font-semibold hover:underline shrink-0">Turn off or change</button>
        </div>
      )}

      <OfflineBar />

      <div className="flex-1 min-h-0 flex md:gap-2 pt-2 md:pr-2 md:pb-2">
        {/* Folder pane: each mailbox is a section, the open one shows its folders */}
        <aside className={`${pane === 'folders' ? 'flex' : 'hidden'} md:flex w-full md:w-[240px] shrink-0 flex-col min-h-0 bg-ol-bg`}>
          <div className="flex-1 min-h-0 overflow-y-auto pb-6">
            {accs.map((a) => (
              <MailboxSection key={a.id} acc={a} active={activeAccount === a.id} current={mailbox} expanded={isUnfolded(a.id)} onToggle={() => toggleUnfolded(a.id)}
                onOpen={(name) => openIn(a.id, name)}
                onDrop={(f, uids) => (a.id === activeAccount ? run('move', uids, f) : say('Mail can only be moved to a folder of the same mailbox.'))}
                onNew={(parent) => newFolder(parent, a.id)} onRename={(f) => renameFolder(f, a.id)} onDelete={(f, cnt) => deleteFolder(f, a.id, cnt)} />
            ))}
          </div>
        </aside>

        {/* Message list */}
        <section className={`${pane === 'list' ? 'flex' : 'hidden'} md:flex w-full md:w-[380px] shrink-0 bg-white md:rounded-lg md:shadow-[0_0_2px_rgba(0,0,0,0.12),0_2px_4px_rgba(0,0,0,0.14)] flex-col min-h-0 overflow-hidden`}>
          <div className="px-3 md:px-4 h-12 flex items-center gap-2 shrink-0">
            <button onClick={() => setPane('folders')} className="md:hidden w-8 h-8 -ml-1 rounded-md inline-flex items-center justify-center text-ol-sub hover:bg-ol-bg" aria-label="Folders"><PanelLeft className="w-5 h-5" /></button>
            {messages.length > 0 && (
              <input type="checkbox" checked={allChecked} onChange={(e) => setChecked(e.target.checked ? messages.map((m) => m.uid) : [])} className="w-4 h-4 accent-[#0f6cbd] shrink-0" aria-label="Select all" title="Select all" />
            )}
            <h2 className="text-[16px] font-semibold text-ol-text truncate flex-1 min-w-0" title={curFolder?.path}>{searching ? `Results in ${folderTitle}` : folderTitle}</h2>
            <span className="text-[12px] text-ol-sub shrink-0 tabular-nums">
              {searching ? (search.data ? `${search.data.matches} found` : '') : total != null ? `${counts[mailbox]?.unread ? `${counts[mailbox].unread} unread · ` : ''}${total}` : ''}
            </span>
          </div>
          <div className="px-3 md:px-4 flex items-center gap-4 border-b border-ol-line shrink-0">
            {searching ? (<>
              <span className="h-9 inline-flex items-center text-[13px] text-ol-sub truncate">“{q}”</span>
              <button onClick={() => { setSearchInput(''); setQ(''); }} className="h-9 text-[13px] text-ol hover:underline ml-auto shrink-0">Exit search</button>
            </>) : [['', 'All'], ['unread', 'Unread'], ['flagged', 'Flagged']].map(([k, l]) => (
              <button key={k} type="button" onClick={() => { setFilter(k); setSelected(null); setChecked([]); }}
                className={`relative h-9 text-[14px] ${filter === k ? 'text-ol-text font-semibold' : 'text-ol-sub hover:text-ol-text'}`}>
                {l}{filter === k && <span className="absolute left-0 right-0 bottom-0 h-[3px] rounded-full bg-ol" />}
              </button>
            ))}
          </div>
          {checked.length > 0 && (
            <div className="px-3 md:px-4 h-9 flex items-center gap-2 bg-ol-soft text-[13px] shrink-0">
              <span className="font-semibold text-ol-text">{checked.length} selected</span>
              <span className="text-ol-sub hidden sm:inline">· use the ribbon, or drag onto a folder</span>
              <button className="ml-auto text-ol hover:underline" onClick={() => setChecked([])}>Clear</button>
            </div>
          )}

          <div className="flex-1 min-h-0 overflow-y-auto">
            {accounts.isError && <div className="px-5 py-8 text-[13px] text-red-600 flex items-start gap-2"><AlertCircle className="w-4 h-4 shrink-0 mt-0.5" /><span>{String(accounts.error.message)}</span></div>}
            {!accounts.isLoading && accs.length === 0 && !accounts.isError && <div className="px-5 py-8 text-[13px] text-ol-sub">No mailboxes configured yet.</div>}
            {shownLoading && <div className="px-5 py-10 text-center text-[13px] text-ol-sub">{searching ? 'Searching…' : 'Loading…'}</div>}
            {shownError && !messages.length && <div className="px-5 py-8 text-[13px] text-red-600 flex items-start gap-2"><AlertCircle className="w-4 h-4 shrink-0 mt-0.5" /><span>{String(shownError.message)}</span></div>}
            {!shownLoading && !shownError && messages.length === 0 && (searching ? search.data : list.data) && (
              <div className="px-5 py-14 text-center">
                <MailIcon className="w-10 h-10 mx-auto mb-3 text-ol/40" strokeWidth={1.2} />
                <p className="text-[15px] font-semibold text-ol-text">{searching ? 'No results' : filter === 'unread' ? 'No unread mail' : filter === 'flagged' ? 'Nothing flagged' : 'All done for the day'}</p>
                <p className="text-[13px] text-ol-sub mt-1">{searching ? `Nothing found for “${q}” in ${folderTitle}.` : 'This folder has nothing to show.'}</p>
              </div>
            )}

            <ul>
              {rows.map((row, i) => {
                const m = row.head;
                const uids = row.items.map((x) => x.uid);
                const isChecked = uids.every((u) => checked.includes(u));
                const rowTargets = isChecked ? checked : uids;
                const grp = groupOf(m.date);
                const newGroup = !searching && (i === 0 || groupOf(rows[i - 1].head.date) !== grp);
                const isSel = uids.includes(selected);
                const n = row.items.length;
                const unread = row.items.some((x) => !x.seen);
                const flagged = row.items.some((x) => x.flagged);
                const open = openRows.has(row.key);
                const who = [...new Set(row.items.map((x) => displayName(x.from)))].join(', ');
                return (
                  <React.Fragment key={row.key}>
                  {newGroup && <li className="px-4 pt-3 pb-1 text-[13px] font-semibold text-ol-text bg-white">{grp}</li>}
                  <ContextMenu>
                  <ContextMenuTrigger asChild>
                  <li data-uid={m.uid} draggable
                    onDragStart={(e) => { e.dataTransfer.setData('application/x-pbmail', JSON.stringify(rowTargets)); e.dataTransfer.effectAllowed = 'move'; }}
                    className={`group relative flex items-stretch border-b border-[#f0f0f0] ${isSel && (!open || selected === m.uid) ? 'bg-ol-sel' : isChecked ? 'bg-ol-soft' : 'hover:bg-ol-hover2'}`}>
                    {unread && <span className="absolute left-0 top-0 bottom-0 w-[3px] bg-ol" />}
                    <span className="w-6 shrink-0 flex justify-end pt-[17px]">
                      {n > 1 && (
                        <button onClick={() => setOpenRows((s0) => { const t = new Set(s0); t.has(row.key) ? t.delete(row.key) : t.add(row.key); return t; })}
                          aria-label={open ? 'Collapse conversation' : 'Expand conversation'} aria-expanded={open} title={open ? 'Hide the messages' : `Show the ${n} messages`}
                          className="w-6 h-6 rounded flex items-center justify-center text-ol-sub hover:bg-white hover:text-ol-text">
                          <ChevronRight className={`w-4 h-4 transition-transform ${open ? 'rotate-90' : ''}`} />
                        </button>
                      )}
                    </span>
                    <label className="pl-1 pr-2 pt-3 cursor-pointer relative w-[42px] shrink-0" title="Select">
                      <span className={checked.length || isChecked ? 'hidden' : 'md:group-hover:hidden'}><Avatar name={displayName(m.from)} size={32} /></span>
                      <span className={`${checked.length || isChecked ? 'flex' : 'hidden md:group-hover:flex'} w-8 h-8 items-center justify-center`}>
                        <input type="checkbox" checked={isChecked} onChange={() => setChecked((c) => (isChecked ? c.filter((u) => !uids.includes(u)) : [...new Set([...c, ...uids])]))} className="w-4 h-4 accent-[#0f6cbd]" aria-label="Select" />
                      </span>
                    </label>
                    <button onClick={() => openMessage(m.uid)} className="flex-1 min-w-0 text-left pr-3 py-2.5">
                      <div className="flex items-center gap-2 h-5">
                        <span className={`truncate text-[14px] flex-1 min-w-0 ${unread ? 'text-ol-text font-semibold' : 'text-ol-text'}`}>{who}</span>
                        <span className="shrink-0 hidden md:group-hover:flex items-center gap-0.5 -my-1">
                          <span role="button" tabIndex={0} title="Delete" onClick={(e) => { e.stopPropagation(); del(uids); }} className="w-7 h-7 rounded-md flex items-center justify-center text-ol-sub hover:bg-white hover:text-red-700"><Trash2 className="w-4 h-4" strokeWidth={1.6} /></span>
                          <span role="button" tabIndex={0} title={unread ? 'Mark as read' : 'Mark as unread'} onClick={(e) => { e.stopPropagation(); run(unread ? 'seen' : 'unseen', uids); }} className="w-7 h-7 rounded-md flex items-center justify-center text-ol-sub hover:bg-white hover:text-ol">{unread ? <MailOpen className="w-4 h-4" strokeWidth={1.6} /> : <MailClosed className="w-4 h-4" strokeWidth={1.6} />}</span>
                          <span role="button" tabIndex={0} title={flagged ? 'Remove flag' : 'Flag'} onClick={(e) => { e.stopPropagation(); run(flagged ? 'unflagged' : 'flagged', uids); }} className="w-7 h-7 rounded-md flex items-center justify-center text-ol-sub hover:bg-white hover:text-[#c50f1f]"><Flag className="w-4 h-4" strokeWidth={1.6} /></span>
                        </span>
                        {flagged && <Flag className="w-4 h-4 text-[#c50f1f] shrink-0 md:group-hover:hidden" fill="currentColor" aria-label="Flagged" />}
                      </div>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        {m.important && <AlertTriangle className="w-3.5 h-3.5 text-[#c50f1f] shrink-0" aria-label="High importance" />}
                        {m.answered && <Reply className="w-3.5 h-3.5 text-ol-sub shrink-0" aria-label="Replied" />}
                        <span className={`truncate text-[14px] flex-1 min-w-0 ${unread ? 'text-ol font-semibold' : 'text-ol-sub'}`}>{m.subject}</span>
                        {n > 1 && <span className="shrink-0 h-5 min-w-5 px-1.5 rounded-full bg-ol-bg text-[12px] text-ol-sub tabular-nums inline-flex items-center justify-center" title={`${n} messages in this conversation`}>{n}</span>}
                        {row.items.some((x) => x.attach) && <Paperclip className="w-3.5 h-3.5 text-ol-sub shrink-0" aria-label="Has attachments" />}
                        <span className={`shrink-0 text-[12px] tabular-nums ${unread ? 'text-ol font-semibold' : 'text-ol-sub'}`}>{fmtDate(m.date)}</span>
                      </div>
                    </button>
                  </li>
                  </ContextMenuTrigger>
                  <ContextMenuContent className="w-56">
                    {!checked.length && special !== 'drafts' && <>
                      <ContextMenuItem onSelect={() => composeFor(m.uid, 'reply')}><Reply className="w-4 h-4 mr-2" /> Reply</ContextMenuItem>
                      <ContextMenuItem onSelect={() => composeFor(m.uid, 'replyall')}><ReplyAll className="w-4 h-4 mr-2" /> Reply all</ContextMenuItem>
                      <ContextMenuItem onSelect={() => composeFor(m.uid, 'forward')}><Forward className="w-4 h-4 mr-2" /> Forward</ContextMenuItem>
                      <ContextMenuSeparator />
                    </>}
                    <ContextMenuItem onSelect={() => setMoveFor(rowTargets)}><FolderInput className="w-4 h-4 mr-2" /> Move to…</ContextMenuItem>
                    <ContextMenuItem onSelect={() => run(unread ? 'seen' : 'unseen', rowTargets)}>{unread ? <MailOpen className="w-4 h-4 mr-2" /> : <MailClosed className="w-4 h-4 mr-2" />} Mark as {unread ? 'read' : 'unread'}</ContextMenuItem>
                    <ContextMenuItem onSelect={() => run(flagged ? 'unflagged' : 'flagged', rowTargets)}><Flag className="w-4 h-4 mr-2" /> {flagged ? 'Remove flag' : 'Flag'}</ContextMenuItem>
                    {canArchive && <ContextMenuItem onSelect={() => run('archive', rowTargets)}><Archive className="w-4 h-4 mr-2" /> Archive</ContextMenuItem>}
                    {special === 'junk' ? <ContextMenuItem onSelect={() => notJunk(rowTargets)}><ShieldCheck className="w-4 h-4 mr-2" /> Not junk</ContextMenuItem>
                      : special !== 'drafts' && special !== 'sent' && <ContextMenuItem onSelect={() => junk(rowTargets)}><ShieldAlert className="w-4 h-4 mr-2" /> Junk</ContextMenuItem>}
                    {special === 'trash' && <ContextMenuItem onSelect={() => run('restore', rowTargets)}><Undo2 className="w-4 h-4 mr-2" /> Move back to Inbox</ContextMenuItem>}
                    <ContextMenuSeparator />
                    <ContextMenuItem className="text-red-600" onSelect={() => del(rowTargets)}><Trash2 className="w-4 h-4 mr-2" /> Delete</ContextMenuItem>
                  </ContextMenuContent>
                  </ContextMenu>
                  {open && row.items.map((c) => (
                    <li key={`c${c.uid}`} data-uid={c.uid} draggable onDragStart={(e) => { e.dataTransfer.setData('application/x-pbmail', JSON.stringify([c.uid])); e.dataTransfer.effectAllowed = 'move'; }}
                      className={`relative border-b border-[#f0f0f0] ${selected === c.uid ? 'bg-ol-sel' : 'hover:bg-ol-hover2'}`}>
                      {!c.seen && <span className="absolute left-0 top-0 bottom-0 w-[3px] bg-ol" />}
                      <button onClick={() => openMessage(c.uid)} className="w-full text-left pl-[72px] pr-3 py-2 flex items-center gap-2">
                        <span className={`truncate text-[13px] flex-1 min-w-0 ${c.seen ? 'text-ol-text' : 'font-semibold text-ol-text'}`}>{displayName(c.from)}</span>
                        {c.attach && <Paperclip className="w-3 h-3 text-ol-sub shrink-0" />}
                        <span className={`shrink-0 text-[12px] tabular-nums ${c.seen ? 'text-ol-sub' : 'text-ol font-semibold'}`}>{fmtDate(c.date)}</span>
                      </button>
                    </li>
                  ))}
                  </React.Fragment>
                );
              })}
            </ul>
            {!searching && list.hasNextPage && <AutoMore busy={list.isFetchingNextPage} onMore={() => list.fetchNextPage()} />}
            {!searching && list.hasNextPage && (
              <button onClick={() => list.fetchNextPage()} disabled={list.isFetchingNextPage} className="w-full h-11 text-[13px] text-ol hover:bg-ol-hover2">
                {list.isFetchingNextPage ? 'Loading…' : 'Load older mail'}
              </button>
            )}
          </div>
        </section>

        {/* Reading pane (or the message being written) */}
        <main className={`${pane === 'message' ? 'flex' : 'hidden'} md:flex flex-1 min-w-0 flex-col min-h-0 overflow-hidden`}>
          {compose !== null ? (<>
            <button onClick={() => setPane('list')} className="md:hidden h-10 px-3 inline-flex items-center gap-1.5 text-[14px] text-ol shrink-0 bg-white border-b border-ol-line"><ArrowLeft className="w-4 h-4" /> {folderTitle}</button>
            <Compose open onClose={() => {
                // An edited/discarded draft changes the Drafts folder: refresh, and drop the stale reading pane.
                if (special === 'drafts') setSelected(null);
                qc.invalidateQueries({ queryKey: ['mail', 'list', activeAccount] });
                setTimeout(() => qc.invalidateQueries({ queryKey: ['mail', 'list', activeAccount] }), 2500);
                setCompose(null);
                if (selected == null) setPane('list');
              }} account={activeAccount} fromEmail={myEmail}
              initial={compose} onSend={queueSend} sending={false} error={null} />
          </>) : (<>
          {selected == null && (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center">
                <MailIcon className="w-14 h-14 mx-auto mb-3 text-ol/30" strokeWidth={1} />
                <p className="text-[15px] font-semibold text-ol-text">Select an item to read</p>
                <p className="text-[13px] text-ol-sub mt-1">Nothing is selected. <button onClick={() => openCompose('new')} className="text-ol hover:underline">Write a new message</button></p>
              </div>
            </div>
          )}
          {selected != null && msg.isLoading && <div className="flex-1 flex items-center justify-center text-[13px] text-ol-sub"><Loader2 className="w-5 h-5 animate-spin mr-2 text-ol" /> Loading message…</div>}
          {selected != null && msg.isError && !msg.data && <div className="flex-1 flex items-center justify-center text-[13px] text-red-600 px-6 text-center">{String(msg.error.message)}</div>}

          {msg.data && selected != null && (
            <div className="flex-1 min-h-0 overflow-y-auto pb-2">
              <button onClick={() => setPane('list')} className="md:hidden h-10 px-3 inline-flex items-center gap-1.5 text-[14px] text-ol"><ArrowLeft className="w-4 h-4" /> {folderTitle}</button>
              {/* Subject card */}
              <div className="bg-white md:rounded-lg md:shadow-[0_0_2px_rgba(0,0,0,0.12),0_1px_2px_rgba(0,0,0,0.14)] px-4 md:px-5 py-3 flex items-center gap-2">
                {msg.data.important && <AlertTriangle className="w-4 h-4 text-[#c50f1f] shrink-0" aria-label="High importance" />}
                <h1 className="text-[18px] md:text-[20px] font-semibold text-ol-text break-words flex-1 min-w-0">{(selRow?.head.subject) || msg.data.subject}</h1>
                {convItems.length > 1 && <span className="shrink-0 text-[12px] text-ol-sub">{convItems.length} messages</span>}
                {convOn && relatedQ.isFetching && <Loader2 className="w-4 h-4 animate-spin text-ol-sub shrink-0" aria-label={`Looking in ${otherLabel}`} />}
                {openMsg?.flagged && <Flag className="w-4 h-4 text-[#c50f1f] shrink-0" fill="currentColor" aria-label="Flagged" />}
              </div>
              {convItems.map((it) => {
                const k = `${it.box}:${it.uid}`;
                return (
                  <ConvCard key={k} account={activeAccount} item={it} open={expanded.has(k) || convItems.length === 1} collapsible={convItems.length > 1}
                    onToggle={() => setExpanded((s0) => { const t = new Set(s0); t.has(k) ? t.delete(k) : t.add(k); return t; })}
                    tag={it.box !== mailbox ? otherLabel : null} isDraft={special === 'drafts'}
                    act={{
                      compose: (mode, d, src) => openCompose(mode, d, src),
                      attachment: (i, a, src) => openAttachment(i, a, src),
                      download: (i, a, src) => mail.downloadAttachment(src.uid, i, a.filename, activeAccount, src.box).catch((e) => say(e.message)),
                      print: (d) => printMessage(d),
                    }} />
                );
              })}
            </div>
          )}
          </>)}
        </main>
      </div>

      {notice && (
        <div className="fixed bottom-20 md:bottom-6 left-1/2 -translate-x-1/2 z-50 bg-[#292929] text-white text-[14px] pl-4 pr-2 py-2 rounded-lg shadow-[0_8px_16px_rgba(0,0,0,0.24)] max-w-[calc(100vw-32px)] flex items-center gap-3">
          <span className="py-0.5">{notice.text}</span>
          {notice.undo && <button onClick={notice.undo} className="h-7 px-3 rounded-md text-[#62abf5] hover:bg-white/10 text-[14px] font-semibold">Undo</button>}
          {!notice.undo && <button onClick={() => setNotice(null)} aria-label="Close" className="p-1 text-neutral-400 hover:text-white"><X className="w-3.5 h-3.5" /></button>}
        </div>
      )}

      <Dialog open={!!preview} onOpenChange={(o) => !o && closePreview()}>
        <DialogContent className="max-w-5xl w-[calc(100vw-16px)] h-[90dvh] p-0 gap-0 flex flex-col rounded-lg">
          <DialogHeader className="px-4 h-12 border-b rule flex-row items-center gap-3 space-y-0 shrink-0">
            <Eye className="w-4 h-4 text-neutral-400" /><DialogTitle className="text-[14px] truncate flex-1">{preview?.name}</DialogTitle>
            <a href={preview?.url} download={preview?.name} className="inline-flex items-center gap-1.5 text-[12px] h-8 px-3 border rule hover:bg-neutral-50 mr-8"><Download className="w-3.5 h-3.5" /> Download</a>
          </DialogHeader>
          <div className="flex-1 min-h-0 bg-neutral-100 flex items-center justify-center overflow-auto">
            {preview && (preview.type.startsWith('image/') ? <img src={preview.url} alt={preview.name} className="max-w-full max-h-full object-contain" />
              : preview.type === 'application/pdf' ? <iframe title={preview.name} src={preview.url} className="w-full h-full border-0 bg-white" />
                : <iframe title={preview.name} sandbox="" src={preview.url} className="w-full h-full border-0 bg-white" />)}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={showKeys} onOpenChange={setShowKeys}>
        <DialogContent className="max-w-md rounded-lg">
          <DialogHeader><DialogTitle className="text-[15px]">Keyboard shortcuts</DialogTitle></DialogHeader>
          <div className="grid grid-cols-[auto_1fr] gap-x-5 gap-y-1.5 text-[13px]">
            {[['N', 'New mail'], ['R', 'Reply'], ['Shift R  or  A', 'Reply all'], ['F', 'Forward'], ['↓ / J', 'Next message'], ['↑ / K', 'Previous message'], ['Delete', 'Delete'], ['E', 'Archive'], ['V', 'Move to…'], ['U', 'Mark read / unread'], ['G  or  Insert', 'Flag / unflag'], ['P', 'Print'], ['/', 'Search'], ['Esc', 'Close the message'], ['⌘ / Ctrl Enter', 'Send (in the mail window)']].map(([k, l]) => (
              <React.Fragment key={k}><kbd className="font-fig text-[12px] bg-neutral-100 border border-neutral-200 px-1.5 py-0.5 text-center">{k}</kbd><span className="text-neutral-700">{l}</span></React.Fragment>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      <AutoReplies open={oofOpen} onClose={() => setOofOpen(false)} account={activeAccount} email={myEmail} current={oofQ.data}
        onSaved={(r) => { qc.setQueryData(['mail', 'oof', activeAccount], r); setOofOpen(false); say(r.state === 'Disabled' ? 'Automatic replies are off.' : 'Automatic replies are on.'); }} />

      <MovePicker open={!!moveFor} onClose={() => setMoveFor(null)} account={activeAccount} folders={folders} current={mailbox} count={moveFor?.length || 0}
        onPick={(f) => { const uids = moveFor; setMoveFor(null); run('move', uids, f); }} />

    </OutlookFrame>
  );
}

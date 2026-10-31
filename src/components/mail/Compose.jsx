/* Compose / reply / forward, shown inside the reading pane like Outlook on the web
 * (ribbon with Message / Insert / Options tabs, Send + Discard, To / Cc / Bcc chips).
 * - Rich text (bold, italic, lists, links) in a contentEditable editor.
 *   Pasted formatting is cleaned to a safe allowlist.
 * - Per-mailbox signature (app_settings: mail_signature_<account>) with the UK
 *   Companies Act footer, editable here.
 * - Reply/forward: the original is shown in a sandboxed iframe (untrusted HTML
 *   never runs in our DOM) and appended as a quote at send time.
 * - Attachments (≤ 20 MB total, button or drop files on the window); forwards can
 *   carry the original attachments. Pasted pictures go inline (sent as CID images).
 * - Outlook options: importance (high/low), read receipt; font size, colour,
 *   highlight, alignment, indent, strikethrough. Pasted formatting is kept, cleaned
 *   to a safe allowlist. */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Bold, Italic, Underline, Strikethrough, List, ListOrdered, Link2, RemoveFormatting, Paperclip, X, Send, ChevronDown, PenLine, Loader2, AlignLeft, AlignCenter, AlignRight, IndentIncrease, IndentDecrease, Baseline, Highlighter, ALargeSmall, Image as ImageIcon, AlertTriangle, ArrowDown, MailCheck, MoreHorizontal } from 'lucide-react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { base44 } from '@/api/base44Client';
import { useAuth } from '@/lib/AuthContext';
import { mail } from '@/api/mailClient';
import { Avatar } from '@/components/mail/OutlookHeader';
import { askText } from '@/components/AskText';

const MAX_BYTES = 20 * 1024 * 1024;
const fmtBytes = (n) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
// Keep only the <body> of the original and drop scripts — this HTML is sent to recipients, never rendered in our page.
const cleanQuote = (html) => (html || '').replace(/^[\s\S]*?<body[^>]*>/i, '').replace(/<\/body>[\s\S]*$/i, '').replace(/<script[\s\S]*?<\/script>/gi, '');
const toBase64 = (file) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1]); r.onerror = rej; r.readAsDataURL(file); });

// A draft read back from the mailbox is foreign HTML: strip anything active before
// putting it into the editor (scripts, frames, event handlers, javascript: links).
function sanitizeDraft(html) {
  const doc = new DOMParser().parseFromString(html || '', 'text/html');
  doc.querySelectorAll('script,style,iframe,object,embed,link,meta,form,input,button,textarea,select,base').forEach((n) => n.remove());
  doc.querySelectorAll('*').forEach((el) => [...el.attributes].forEach((a) => {
    const bad = /^\s*(javascript|data|vbscript):/i.test(a.value) && !(el.tagName === 'IMG' && a.name === 'src' && /^\s*data:image\//i.test(a.value));
    if (/^on/i.test(a.name) || (/^(href|src|xlink:href|action)$/i.test(a.name) && bad)) el.removeAttribute(a.name);
  }));
  return doc.body.innerHTML;
}

// Pasted HTML (Word, web pages, other mail): keep structure and simple styling only.
const PASTE_TAGS = new Set(['P', 'BR', 'B', 'STRONG', 'I', 'EM', 'U', 'S', 'STRIKE', 'UL', 'OL', 'LI', 'A', 'SPAN', 'FONT', 'DIV', 'H1', 'H2', 'H3', 'H4', 'BLOCKQUOTE', 'TABLE', 'THEAD', 'TBODY', 'TR', 'TD', 'TH', 'IMG', 'SUB', 'SUP', 'HR', 'PRE', 'CODE']);
const PASTE_STYLE = /^(color|background-color|font-weight|font-style|text-decoration|text-align|font-size|border|border-collapse|padding|width)$/i;
function sanitizePaste(html) {
  const doc = new DOMParser().parseFromString(html || '', 'text/html');
  doc.querySelectorAll('script,style,meta,link,title,xml,o\\:p,iframe,object,embed,form,input,button,textarea,select').forEach((n) => n.remove());
  const clean = (el) => {
    [...el.children].forEach((c) => {
      clean(c);
      if (!PASTE_TAGS.has(c.tagName)) { c.replaceWith(...c.childNodes); return; }
      [...c.attributes].forEach((a) => {
        const n = a.name.toLowerCase();
        if (n === 'href' && c.tagName === 'A' && /^\s*(https?:|mailto:)/i.test(a.value)) return;
        if (n === 'src' && c.tagName === 'IMG' && /^\s*(https:|data:image\/)/i.test(a.value)) return;
        if (n === 'style') { const keep = a.value.split(';').map((d) => d.trim()).filter((d) => PASTE_STYLE.test(d.split(':')[0]?.trim() || '')).join('; '); if (keep) { c.setAttribute('style', keep); return; } }
        if ((n === 'colspan' || n === 'rowspan') && /^\d+$/.test(a.value)) return;
        if (n === 'color' && c.tagName === 'FONT') return;
        c.removeAttribute(a.name);
      });
    });
  };
  clean(doc.body);
  return doc.body.innerHTML;
}
const COLOURS = ['#171717', '#525252', '#b91c1c', '#c2410c', '#a16207', '#15803d', '#1d4ed8', '#7e22ce'];
const HIGHLIGHTS = ['#fef08a', '#bbf7d0', '#bfdbfe', '#fecaca', '#e9d5ff', 'transparent'];

// Address field, Outlook style: finished addresses become chips (name when known),
// suggestions from contacts / tenants / people you write to. The value stays a plain
// "a@b, c@d, " string for the callers.
const looksLikeEmail = (x) => /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/.test(x);
export function AddressInput({ value, onChange, contacts, inputRef, placeholder, className = '' }) {
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  const ownRef = useRef(null); const ref = inputRef || ownRef;
  const parts = (value || '').split(/[,;]/);
  const chips = parts.slice(0, -1).map((x) => x.trim()).filter(Boolean);
  const current = parts[parts.length - 1].replace(/^\s+/, '');
  const emit = (list, text = '') => onChange(list.length ? `${list.join(', ')}, ${text}` : text);
  const token = current.trim().toLowerCase();
  const used = new Set(chips.map((x) => x.toLowerCase()));
  const matches = token ? contacts.filter((c) => !used.has(c.email) && (c.email.includes(token) || (c.name || '').toLowerCase().includes(token))).slice(0, 6) : [];
  const nameOf = (addr) => { const m = addr.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>/); if (m && m[1]) return m[1]; const c = contacts.find((x) => x.email === addr.toLowerCase()); return c?.name || addr; };
  const pick = (c) => { emit([...chips, c.email]); setOpen(false); setHi(0); ref.current?.focus(); };
  const commit = () => { const t = current.trim(); if (t) emit([...chips, t]); };
  return (
    <div className={`relative flex-1 min-w-0 flex flex-wrap items-center gap-1 py-1 cursor-text ${className}`} onClick={() => ref.current?.focus()}>
      {chips.map((addr, i) => {
        const bare = (addr.match(/<([^>]+)>/)?.[1] || addr).trim();
        const ok = looksLikeEmail(bare);
        return (
          <span key={`${addr}-${i}`} title={bare} className={`group inline-flex items-center gap-1 h-6 pl-2 pr-1 rounded-full text-[13px] max-w-full ${ok ? 'bg-ol-bg text-ol-text hover:bg-ol-soft' : 'bg-red-50 text-red-700 underline decoration-wavy decoration-red-400'}`}>
            <span className="truncate">{nameOf(addr)}</span>
            <button type="button" aria-label={`Remove ${bare}`} onClick={(e) => { e.stopPropagation(); emit(chips.filter((_, j) => j !== i), current); }}
              className="w-4 h-4 rounded-full flex items-center justify-center text-ol-sub hover:bg-white hover:text-ol-text"><X className="w-3 h-3" /></button>
          </span>
        );
      })}
      <input ref={ref} value={current} placeholder={chips.length ? '' : placeholder} autoComplete="off"
        className="flex-1 min-w-[140px] h-7 bg-transparent text-[14px] outline-none placeholder:text-ol-mute"
        onChange={(e) => { const t = e.target.value; if (/[,;]/.test(t)) emit([...chips, ...t.split(/[,;]/).slice(0, -1).map((x) => x.trim()).filter(Boolean)], t.split(/[,;]/).pop().trimStart()); else emit(chips, t); setOpen(true); setHi(0); }}
        onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => { setOpen(false); if (looksLikeEmail(current.trim())) commit(); }, 150)}
        onKeyDown={(e) => {
          if (e.key === 'Backspace' && !current && chips.length) { e.preventDefault(); emit(chips.slice(0, -1), ''); return; }
          if (open && matches.length) {
            if (e.key === 'ArrowDown') { e.preventDefault(); setHi((hi + 1) % matches.length); return; }
            if (e.key === 'ArrowUp') { e.preventDefault(); setHi((hi - 1 + matches.length) % matches.length); return; }
            if ((e.key === 'Enter' || e.key === 'Tab') && !e.metaKey && !e.ctrlKey) { e.preventDefault(); pick(matches[hi]); return; }
          }
          if ((e.key === 'Enter' || e.key === 'Tab') && !e.metaKey && !e.ctrlKey && looksLikeEmail(current.trim())) { if (e.key === 'Enter') e.preventDefault(); commit(); }
        }} />
      {open && matches.length > 0 && (
        <div className="absolute z-50 left-0 top-full mt-1 w-full max-w-[420px] bg-white rounded-lg border border-ol-line shadow-[0_8px_16px_rgba(0,0,0,0.14)] py-1">
          <div className="px-3 pt-1 pb-1 text-[12px] font-semibold text-ol-sub">Suggested contacts</div>
          {matches.map((c, i) => (
            <button type="button" key={c.email} onMouseDown={(e) => { e.preventDefault(); pick(c); }}
              className={`w-full text-left px-3 py-1.5 flex items-center gap-2.5 ${i === hi ? 'bg-ol-soft' : 'hover:bg-ol-hover2'}`}>
              <Avatar name={c.name || c.email} size={28} />
              <span className="min-w-0 flex-1">
                <span className="block text-[14px] text-ol-text truncate">{c.name || c.email}</span>
                {c.name && <span className="block text-[12px] text-ol-sub truncate">{c.email}</span>}
              </span>
              {c.tag && <span className="text-[11px] text-ol-mute">{c.tag}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// Suggestions for address fields: saved contacts, tenants, then people you write to / hear from.
export function useAddressBook(account, enabled = true) {
  const { data: mailContacts } = useQuery({ queryKey: ['mail', 'contacts', account], enabled: enabled && !!account, staleTime: 10 * 60 * 1000, queryFn: () => mail.contacts(account).then((r) => r.contacts || []) });
  const { data: saved } = useQuery({ queryKey: ['mail', 'people', account], enabled: enabled && !!account, staleTime: 5 * 60 * 1000, retry: false, queryFn: () => mail.people(account).then((r) => r.contacts || []).catch(() => []) });
  const { data: tenants = [] } = useQuery({ queryKey: ['tenants'], enabled, queryFn: () => base44.entities.Tenant.list('name') });
  return useMemo(() => {
    const m = new Map();
    (saved || []).forEach((c) => (c.emails || []).forEach((e) => { const k = e.toLowerCase(); if (!m.has(k)) m.set(k, { email: k, name: c.name, tag: 'contact' }); }));
    tenants.filter((t) => t.email).forEach((t) => { const k = t.email.toLowerCase(); if (!m.has(k)) m.set(k, { email: k, name: t.name, tag: 'tenant' }); });
    (mailContacts || []).forEach((c) => { if (!m.has(c.email)) m.set(c.email, c); });
    return [...m.values()];
  }, [saved, tenants, mailContacts]);
}

// Ribbon button (Outlook "simplified ribbon"): icon, optional label, pressed state.
function Tool({ icon: Icon, title, onClick, label, on }) {
  return (
    <button type="button" title={title} aria-label={title} aria-pressed={on} onMouseDown={(e) => { e.preventDefault(); onClick(); }}
      className={`h-8 shrink-0 inline-flex items-center gap-1.5 rounded-md text-[13px] ${label ? 'px-2' : 'w-8 justify-center'} ${on ? 'bg-ol-sel text-ol' : 'text-[#424242] hover:bg-ol-bg'}`}>
      <Icon className="w-[18px] h-[18px]" strokeWidth={1.6} />{label && <span className="whitespace-nowrap">{label}</span>}
    </button>
  );
}
const Sep = () => <span className="w-px h-5 bg-ol-line mx-1 shrink-0" />;

export default function Compose({ open, onClose, account, fromEmail, initial, onSend, sending, error }) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const editor = useRef(null);
  const [editorEl, setEditorEl] = useState(null); // set when the dialog content actually mounts
  const filledFor = useRef(null);
  const toRef = useRef(null);
  const [to, setTo] = useState(''); const [cc, setCc] = useState(''); const [bcc, setBcc] = useState('');
  const [showCcBcc, setShowCcBcc] = useState(false);
  const [subject, setSubject] = useState('');
  const [files, setFiles] = useState([]);
  const [keepFwd, setKeepFwd] = useState(true);
  const [showQuote, setShowQuote] = useState(false);
  const [sigEdit, setSigEdit] = useState(false);
  const [localErr, setLocalErr] = useState(null);
  const [importance, setImportance] = useState('normal'); // 'high' | 'normal' | 'low'
  const [readReceipt, setReadReceipt] = useState(false);
  const [dropping, setDropping] = useState(false);
  const sigRef = useRef(null);
  const ccRef = useRef(null); const bccRef = useRef(null);
  // Drafts: autosaved to the mailbox's Drafts folder a few seconds after each change.
  const draftUid = useRef(null);
  const [dirty, setDirty] = useState(0);
  const [draftStatus, setDraftStatus] = useState('');
  const saving = useRef(false);
  const sentOrDiscarded = useRef(false);
  const touch = () => setDirty((d) => d + 1);

  const contacts = useAddressBook(account, open);

  const sigId = `mail_signature_${account}`;
  const { data: sigRow, isFetched: sigReady } = useQuery({ queryKey: ['app_settings', sigId], enabled: !!account, queryFn: () => base44.entities.AppSetting.get(sigId).catch(() => null) });
  const signature = sigRow?.value?.html || '';

  // Fill the editor when the window opens (and once the signature is known).
  useEffect(() => {
    if (!open) return;
    setTo(initial?.to || ''); setCc(initial?.cc || ''); setBcc(initial?.bcc || ''); setShowCcBcc(!!(initial?.cc || initial?.bcc));
    setSubject(initial?.subject || ''); setFiles(initial?.files || []); setKeepFwd(initial?.keepFwd ?? true); setShowQuote(false); setSigEdit(false); setLocalErr(null);
    setImportance(initial?.importance || 'normal'); setReadReceipt(!!initial?.readReceipt);
    draftUid.current = initial?.draftUid || null; setDirty(0); setDraftStatus(initial?.draftUid ? 'Editing a saved draft' : ''); sentOrDiscarded.current = false;
  }, [open, initial]);
  // Fill the editor once per opening, as soon as it is mounted and the signature
  // query has answered (never again afterwards, so typing is never wiped).
  useEffect(() => {
    if (!open) { filledFor.current = null; return; }
    if (!editorEl || !sigReady || filledFor.current === initial) return;
    filledFor.current = initial;
    editor.current = editorEl;
    editorEl.innerHTML = initial?.bodyHtml != null
      ? sanitizeDraft(initial.bodyHtml)
      : `${initial?.introHtml || '<p><br></p><p><br></p>'}${signature ? `<div data-signature="1">${signature}</div>` : ''}`;
    requestAnimationFrame(() => {
      if (initial?.to) { // reply / reply-all: cursor at the top of the message body
        editorEl.focus();
        const r = document.createRange(); r.setStart(editorEl.firstChild || editorEl, 0); r.collapse(true);
        const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(r);
      } else toRef.current?.focus();
    });
  }, [open, editorEl, sigReady, signature, initial]);

  const cmd = (c, v) => { document.execCommand(c, false, v); editor.current?.focus(); };
  // The link dialog takes the focus away: remember the selection and put it back first.
  const addLink = async () => {
    const sel = window.getSelection(); const range = sel.rangeCount ? sel.getRangeAt(0).cloneRange() : null;
    const url = await askText('Link address', { placeholder: 'https://…', okLabel: 'Insert' });
    if (!url?.trim()) return;
    editor.current?.focus();
    if (range) { const s2 = window.getSelection(); s2.removeAllRanges(); s2.addRange(range); }
    const href = /^(https?:|mailto:)/i.test(url.trim()) ? url.trim() : `https://${url.trim()}`;
    if (range && !range.collapsed) cmd('createLink', href);
    else cmd('insertHTML', `<a href="${esc(href)}">${esc(url.trim())}</a>`);
    touch();
  };

  const addFiles = (list) => {
    const next = [...files, ...list.map((f) => ({ file: f, name: f.name, size: f.size, type: f.type }))];
    if (next.reduce((n, f) => n + f.size, 0) > MAX_BYTES) return setLocalErr('Attachments are limited to 20 MB in total.');
    setLocalErr(null); setFiles(next);
  };
  const pickFiles = (e) => { const list = Array.from(e.target.files || []); e.target.value = ''; addFiles(list); };
  // Pictures: pasted or picked ones go inside the text (≤ 5 MB each).
  const insertImages = async (imgs) => {
    for (const f of imgs) {
      if (f.size > 5 * 1024 * 1024) { setLocalErr(`${f.name || 'Picture'} is over 5 MB: attach it instead.`); continue; }
      const b64 = await toBase64(f);
      editor.current?.focus();
      document.execCommand('insertHTML', false, `<img src="data:${f.type};base64,${b64}" style="max-width:100%">`);
    }
    touch();
  };
  const onPaste = (e) => {
    e.preventDefault();
    const imgs = Array.from(e.clipboardData.files || []).filter((f) => f.type.startsWith('image/'));
    if (imgs.length) { insertImages(imgs); return; }
    const html = e.clipboardData.getData('text/html');
    if (html) document.execCommand('insertHTML', false, sanitizePaste(html));
    else document.execCommand('insertText', false, e.clipboardData.getData('text/plain'));
    touch();
  };

  const quoteBlock = () => {
    if (!initial?.quoteHtml && !initial?.quoteText) return { html: '', text: '' };
    const body = initial.quoteHtml ? cleanQuote(initial.quoteHtml) : esc(initial.quoteText).replace(/\n/g, '<br>');
    return {
      html: `<br><div style="font-size:13px;color:#525252">${initial.quoteHeader}</div><blockquote style="margin:6px 0 0 .8ex;border-left:2px solid #d4d4d4;padding-left:1ex">${body}</blockquote>`,
      text: `\n\n${initial.quoteHeader.replace(/<br>/g, '\n').replace(/<[^>]+>/g, '')}\n${(initial.quoteText || '').split('\n').map((l) => `> ${l}`).join('\n')}`,
    };
  };

  const draftPayload = () => {
    const q = quoteBlock();
    return { to, cc, bcc, subject, inReplyTo: initial?.inReplyTo || '', references: initial?.references || '',
      html: `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;color:#171717">${editor.current?.innerHTML || ''}${q.html}</div>`,
      text: (editor.current?.innerText || '').trim() + q.text };
  };
  const saveDraftNow = async () => {
    if (saving.current || sentOrDiscarded.current || !account) return;
    saving.current = true; setDraftStatus('Saving draft…');
    try {
      const r = await mail.saveDraft(account, { ...draftPayload(), replace_uid: draftUid.current });
      draftUid.current = r.uid || draftUid.current;
      setDraftStatus(`Draft saved ${new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}${files.length ? ' (attachments are not kept in drafts)' : ''}`);
    } catch (e) { setDraftStatus(`Draft not saved: ${e.message}`); }
    finally { saving.current = false; }
  };
  useEffect(() => {
    if (!open || dirty === 0) return;
    const t = setTimeout(saveDraftNow, 3000);
    return () => clearTimeout(t);
  }, [dirty, open]);

  // Closing (×, Esc, click outside) keeps the work as a draft; "Discard" deletes it.
  const close = () => { if (dirty > 0 && !sentOrDiscarded.current) saveDraftNow(); onClose(); };
  const discard = async () => {
    if (draftUid.current) {
      if (!confirm('Delete this draft?')) return;
      sentOrDiscarded.current = true;
      try { await mail.deleteDraft(draftUid.current, account); } catch { /* already gone */ }
    }
    sentOrDiscarded.current = true; onClose();
  };

  const send = async () => {
    if (!to.trim()) return setLocalErr('Add at least one recipient.');
    setLocalErr(null);
    const q = quoteBlock();
    const bodyHtml = editor.current?.innerHTML || '';
    const attachments = await Promise.all(files.map(async (f) => ({ filename: f.name, contentType: f.type || 'application/octet-stream', content_base64: await toBase64(f.file) })));
    onSend({
      to, cc, bcc, subject,
      html: `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;color:#171717">${bodyHtml}${q.html}</div>`,
      text: (editor.current?.innerText || '').trim() + q.text,
      attachments,
      inReplyTo: initial?.inReplyTo || '', references: initial?.references || '',
      importance: importance === 'normal' ? undefined : importance, readReceipt: readReceipt || undefined,
      forward_from: initial?.forwardFrom && keepFwd ? initial.forwardFrom : undefined,
      draft_uid: draftUid.current || undefined,
    }, {
      // Everything needed to reopen this window as it was ("Undo" within 10 seconds).
      ...initial, to, cc, bcc, subject, bodyHtml, files, keepFwd, importance, readReceipt, draftUid: draftUid.current || null,
    });
    sentOrDiscarded.current = true;
  };

  const saveSignature = async () => {
    const html = sigRef.current?.innerHTML || '';
    try { await base44.entities.AppSetting.update(sigId, { value: { html }, updated_by: user?.email || '', updated_date: new Date().toISOString() }); }
    catch { await base44.entities.AppSetting.create({ id: sigId, value: { html }, updated_by: user?.email || '' }); }
    await qc.invalidateQueries({ queryKey: ['app_settings', sigId] });
    setSigEdit(false);
  };

  const fwdAtts = initial?.forwardAttachments || [];
  const [tab, setTab] = useState('message');
  const fileInput = useRef(null); const picInput = useRef(null);
  if (!open) return null;

  const row = 'flex items-center gap-2 border-b border-ol-line min-h-[40px]';
  const fieldBtn = 'h-7 px-2.5 rounded-md border border-ol-line text-[14px] text-ol-text hover:bg-ol-bg shrink-0 min-w-[46px]';
  const sizeMenu = (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" title="Font size" onMouseDown={(e) => e.preventDefault()} className="h-8 px-2 shrink-0 inline-flex items-center gap-1 rounded-md border border-ol-line text-[13px] text-ol-text hover:bg-ol-bg">
          <ALargeSmall className="w-4 h-4" /> Size <ChevronDown className="w-3 h-3" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent onCloseAutoFocus={(e) => e.preventDefault()}>
        {[['Small', 2], ['Normal', 3], ['Large', 5], ['Huge', 6]].map(([l, v]) => <DropdownMenuItem key={v} onSelect={() => cmd('fontSize', v)} style={{ fontSize: [0, 0, 12, 14, 0, 18, 22][v] }}>{l}</DropdownMenuItem>)}
      </DropdownMenuContent>
    </DropdownMenu>
  );
  const swatches = (icon, title, list, command) => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild><button type="button" title={title} aria-label={title} onMouseDown={(e) => e.preventDefault()} className="h-8 w-9 shrink-0 inline-flex items-center justify-center gap-0.5 rounded-md text-[#424242] hover:bg-ol-bg">{React.createElement(icon, { className: 'w-[18px] h-[18px]', strokeWidth: 1.6 })}<ChevronDown className="w-2.5 h-2.5" /></button></DropdownMenuTrigger>
      <DropdownMenuContent onCloseAutoFocus={(e) => e.preventDefault()} className="flex gap-1 p-2">
        {list.map((c) => <button key={c} type="button" title={c === 'transparent' ? 'None' : c} onMouseDown={(e) => { e.preventDefault(); cmd(command, c); }} className="w-6 h-6 rounded border border-ol-line text-[10px]" style={{ background: c }}>{c === 'transparent' ? '×' : ''}</button>)}
      </DropdownMenuContent>
    </DropdownMenu>
  );
  const attachTool = <Tool icon={Paperclip} title="Attach file" label="Attach file" onClick={() => fileInput.current?.click()} />;
  const pictureTool = <Tool icon={ImageIcon} title="Insert a picture in the text" label="Pictures" onClick={() => picInput.current?.click()} />;
  const linkTool = <Tool icon={Link2} title="Link" label="Link" onClick={addLink} />;
  const sigTool = <Tool icon={PenLine} title="Signature" label="Signature" on={sigEdit} onClick={() => setSigEdit((v) => !v)} />;
  const highTool = <Tool icon={AlertTriangle} title="High importance" label="High importance" on={importance === 'high'} onClick={() => setImportance((v) => (v === 'high' ? 'normal' : 'high'))} />;
  const lowTool = <Tool icon={ArrowDown} title="Low importance" label="Low importance" on={importance === 'low'} onClick={() => setImportance((v) => (v === 'low' ? 'normal' : 'low'))} />;
  const receiptTool = <Tool icon={MailCheck} title="Request a read receipt" label="Read receipt" on={readReceipt} onClick={() => setReadReceipt((v) => !v)} />;

  return (
    <div className="relative flex-1 min-h-0 flex flex-col bg-white md:rounded-lg md:shadow-[0_0_2px_rgba(0,0,0,0.12),0_2px_4px_rgba(0,0,0,0.14)] overflow-hidden"
      onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); if (!sending) send(); } }}
      onDragOver={(e) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); setDropping(true); } }}
      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setDropping(false); }}
      onDrop={(e) => { if (!e.dataTransfer.files?.length) return; e.preventDefault(); setDropping(false); addFiles(Array.from(e.dataTransfer.files)); }}>
      {dropping && <div className="absolute inset-2 z-50 rounded-lg bg-ol-soft/95 border-2 border-dashed border-ol flex items-center justify-center text-[15px] font-semibold text-ol pointer-events-none">Drop files here to attach them</div>}
      <input ref={fileInput} type="file" multiple className="hidden" onChange={pickFiles} />
      <input ref={picInput} type="file" accept="image/*" multiple className="hidden" onChange={(e) => { const l = Array.from(e.target.files || []); e.target.value = ''; insertImages(l); }} />

      {/* Ribbon: Message / Insert / Options, like Outlook's compose tabs */}
      <div className="shrink-0 border-b border-ol-line">
        <div className="flex items-center gap-1 px-3 h-9">
          {[['message', 'Message'], ['insert', 'Insert'], ['options', 'Options']].map(([k, l]) => (
            <button key={k} type="button" onClick={() => setTab(k)} className={`relative h-9 px-2.5 text-[14px] ${tab === k ? 'text-ol-text font-semibold' : 'text-ol-sub hover:text-ol-text'}`}>
              {l}{tab === k && <span className="absolute left-2.5 right-2.5 bottom-1 h-[3px] rounded-full bg-ol" />}
            </button>
          ))}
          <span className="ml-auto text-[12px] text-ol-sub truncate">{initial?.title || 'New message'}</span>
          <button type="button" onClick={close} title="Close (kept as a draft)" aria-label="Close" className="w-8 h-8 rounded-md flex items-center justify-center text-ol-sub hover:bg-ol-bg hover:text-ol-text"><X className="w-4 h-4" /></button>
        </div>
        <div className="flex items-center gap-0.5 px-2 pb-1.5 overflow-x-auto">
          {tab === 'message' && <>
            {sizeMenu}<Sep />
            <Tool icon={Bold} title="Bold (⌘B)" onClick={() => cmd('bold')} />
            <Tool icon={Italic} title="Italic (⌘I)" onClick={() => cmd('italic')} />
            <Tool icon={Underline} title="Underline (⌘U)" onClick={() => cmd('underline')} />
            <Tool icon={Strikethrough} title="Strikethrough" onClick={() => cmd('strikeThrough')} />
            {swatches(Highlighter, 'Highlight', HIGHLIGHTS, 'hiliteColor')}
            {swatches(Baseline, 'Font colour', COLOURS, 'foreColor')}
            <Sep />
            <Tool icon={List} title="Bullets" onClick={() => cmd('insertUnorderedList')} />
            <Tool icon={ListOrdered} title="Numbering" onClick={() => cmd('insertOrderedList')} />
            <Tool icon={IndentDecrease} title="Decrease indent" onClick={() => cmd('outdent')} />
            <Tool icon={IndentIncrease} title="Increase indent" onClick={() => cmd('indent')} />
            <Tool icon={AlignLeft} title="Align left" onClick={() => cmd('justifyLeft')} />
            <Tool icon={AlignCenter} title="Centre" onClick={() => cmd('justifyCenter')} />
            <Tool icon={AlignRight} title="Align right" onClick={() => cmd('justifyRight')} />
            <Tool icon={RemoveFormatting} title="Clear formatting" onClick={() => cmd('removeFormat')} />
            <Sep />
            <Tool icon={Paperclip} title="Attach file" onClick={() => fileInput.current?.click()} />
            <Tool icon={Link2} title="Link" onClick={addLink} />
            <Tool icon={ImageIcon} title="Insert a picture in the text" onClick={() => picInput.current?.click()} />
            <Tool icon={PenLine} title="Signature" on={sigEdit} onClick={() => setSigEdit((v) => !v)} />
            <Tool icon={AlertTriangle} title="High importance" on={importance === 'high'} onClick={() => setImportance((v) => (v === 'high' ? 'normal' : 'high'))} />
            <Tool icon={ArrowDown} title="Low importance" on={importance === 'low'} onClick={() => setImportance((v) => (v === 'low' ? 'normal' : 'low'))} />
          </>}
          {tab === 'insert' && <>{attachTool}{pictureTool}{linkTool}{sigTool}</>}
          {tab === 'options' && <>{highTool}{lowTool}{receiptTool}</>}
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="px-4 md:px-6">
          {/* Send / Discard, then the address lines */}
          <div className="flex items-center gap-2 pt-3 pb-2 flex-wrap">
            <button type="button" onClick={send} disabled={sending} className="h-8 pl-3 pr-4 rounded-md bg-ol hover:bg-ol-hover active:bg-ol-press text-white text-[14px] font-semibold inline-flex items-center gap-2 disabled:opacity-60">
              {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />} Send
            </button>
            <button type="button" onClick={discard} className="h-8 px-3 rounded-md border border-ol-line bg-white text-[14px] text-ol-text hover:bg-ol-bg">Discard</button>
            {importance === 'high' && <span className="inline-flex items-center gap-1 h-6 px-2 rounded-full text-[12px] text-red-700 bg-red-50"><AlertTriangle className="w-3 h-3" /> High importance</span>}
            {importance === 'low' && <span className="inline-flex items-center gap-1 h-6 px-2 rounded-full text-[12px] text-ol-sub bg-ol-bg"><ArrowDown className="w-3 h-3" /> Low importance</span>}
            {readReceipt && <span className="inline-flex items-center gap-1 h-6 px-2 rounded-full text-[12px] text-ol bg-ol-soft"><MailCheck className="w-3 h-3" /> Read receipt</span>}
            <span className="ml-auto text-[12px] min-w-0 truncate">{(localErr || error) ? <span className="text-red-600">{localErr || error}</span> : <span className="text-ol-mute">{draftStatus}</span>}</span>
          </div>
          <div className={row}><span className="text-[14px] text-ol-sub w-[52px] shrink-0">From:</span><span className="text-[14px] text-ol-text truncate">{fromEmail}</span></div>
          <div className={row}>
            <button type="button" className={fieldBtn} onClick={() => toRef.current?.focus()}>To</button>
            <AddressInput inputRef={toRef} value={to} onChange={(v) => { setTo(v); touch(); }} contacts={contacts} />
            {!showCcBcc && <><button type="button" onClick={() => { setShowCcBcc(true); setTimeout(() => ccRef.current?.focus(), 0); }} className="text-[14px] text-ol-sub hover:text-ol px-1">Cc</button><button type="button" onClick={() => { setShowCcBcc(true); setTimeout(() => bccRef.current?.focus(), 0); }} className="text-[14px] text-ol-sub hover:text-ol px-1">Bcc</button></>}
          </div>
          {showCcBcc && <>
            <div className={row}><button type="button" className={fieldBtn} onClick={() => ccRef.current?.focus()}>Cc</button><AddressInput inputRef={ccRef} value={cc} onChange={(v) => { setCc(v); touch(); }} contacts={contacts} /></div>
            <div className={row}><button type="button" className={fieldBtn} onClick={() => bccRef.current?.focus()}>Bcc</button><AddressInput inputRef={bccRef} value={bcc} onChange={(v) => { setBcc(v); touch(); }} contacts={contacts} /></div>
          </>}
          <div className={row}>
            <input value={subject} onChange={(e) => { setSubject(e.target.value); touch(); }} placeholder="Add a subject" className="flex-1 h-10 bg-transparent text-[14px] outline-none placeholder:text-ol-mute" />
          </div>

          {(files.length > 0 || fwdAtts.length > 0) && (
            <div className="py-2.5 flex flex-wrap gap-2 items-center border-b border-ol-line">
              {files.map((f, i) => (
                <span key={i} className="inline-flex items-center gap-2 h-12 pl-2.5 pr-1 rounded-md border border-ol-line bg-white max-w-[260px]">
                  <Paperclip className="w-5 h-5 text-ol shrink-0" strokeWidth={1.5} />
                  <span className="min-w-0"><span className="block text-[13px] text-ol-text truncate">{f.name}</span><span className="block text-[12px] text-ol-sub">{fmtBytes(f.size)}</span></span>
                  <button type="button" onClick={() => setFiles(files.filter((_, j) => j !== i))} aria-label={`Remove ${f.name}`} className="w-7 h-7 rounded-md flex items-center justify-center text-ol-sub hover:bg-ol-bg hover:text-ol-text"><X className="w-3.5 h-3.5" /></button>
                </span>
              ))}
              {fwdAtts.length > 0 && (
                <label className="inline-flex items-center gap-1.5 text-[13px] text-ol-sub cursor-pointer">
                  <input type="checkbox" checked={keepFwd} onChange={(e) => setKeepFwd(e.target.checked)} className="accent-[#0f6cbd]" />
                  Include the original's {fwdAtts.length} attachment{fwdAtts.length > 1 ? 's' : ''} ({fwdAtts.map((a) => a.filename).join(', ').slice(0, 80)})
                </label>
              )}
            </div>
          )}

          {sigEdit && (
            <div className="mt-3 rounded-lg border border-ol-line bg-ol-hover2 p-3">
              <p className="text-[12px] text-ol-sub mb-2">Signature for {fromEmail}. Keep the company line: UK law requires the registered name, number, place of registration and registered office on business emails.</p>
              <div ref={sigRef} contentEditable suppressContentEditableWarning className="bg-white border border-ol-line rounded-md p-3 text-[13px] focus:outline-none focus:border-ol"
                dangerouslySetInnerHTML={{ __html: signature }} onPaste={(e) => { e.preventDefault(); document.execCommand('insertText', false, e.clipboardData.getData('text/plain')); }} />
              <div className="mt-2 flex gap-2">
                <button type="button" onClick={saveSignature} className="h-8 px-3 rounded-md bg-ol hover:bg-ol-hover text-white text-[13px] font-semibold">Save signature</button>
                <button type="button" onClick={() => setSigEdit(false)} className="h-8 px-3 rounded-md border border-ol-line bg-white text-[13px] hover:bg-ol-bg">Cancel</button>
              </div>
            </div>
          )}

          <div ref={(el) => { editor.current = el; setEditorEl(el); }} contentEditable suppressContentEditableWarning role="textbox" aria-multiline="true" aria-label="Message body" onInput={touch}
            className="min-h-[260px] py-4 text-[14px] leading-relaxed text-ol-text focus:outline-none [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:list-decimal [&_ol]:pl-6 [&_a]:text-ol [&_a]:underline [&_blockquote]:ml-6 [&_img]:max-w-full [&_table]:border-collapse [&_td]:border [&_td]:border-neutral-300 [&_td]:px-2"
            onPaste={onPaste} />

          {(initial?.quoteHtml || initial?.quoteText) && (
            <div className="pb-6">
              <button type="button" onClick={() => setShowQuote((v) => !v)} title={showQuote ? 'Hide the original message' : 'Show the original message'}
                className="h-6 px-2 rounded-md bg-ol-bg hover:bg-ol-line text-ol-sub inline-flex items-center gap-1 text-[12px]">
                {showQuote ? <ChevronDown className="w-3.5 h-3.5" /> : <MoreHorizontal className="w-4 h-4" />} {showQuote ? 'Original message (sent below your text)' : ''}
              </button>
              {showQuote && (
                <iframe title="quoted" sandbox="" className="w-full h-72 mt-2 border-l-2 border-ol-line bg-white"
                  srcDoc={`<!doctype html><meta charset="utf-8"><body style="font-family:'Segoe UI',-apple-system,sans-serif;font-size:13px;color:#424242;margin:4px 12px"><div style="color:#616161;margin-bottom:8px">${initial.quoteHeader}</div>${initial.quoteHtml ? cleanQuote(initial.quoteHtml) : esc(initial.quoteText).replace(/\n/g, '<br>')}</body>`} />
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

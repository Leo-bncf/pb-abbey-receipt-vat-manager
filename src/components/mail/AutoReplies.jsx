/* Automatic replies (out of office) for one mailbox, set on the Exchange server like
 * Outlook's "Automatic replies": off, on, or on between two dates; one message for
 * people inside PB Abbey and one for everybody else. */
import React, { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { mail } from '@/api/mailClient';

const toLocal = (iso) => { if (!iso) return ''; const d = new Date(iso); const p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; };
const text = (html) => (html || '').replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\n{3,}/g, '\n\n').trim();
const html = (t) => (t || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>');

export default function AutoReplies({ open, onClose, account, email, current, onSaved }) {
  const [f, setF] = useState(null);
  const [same, setSame] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(null);
  useEffect(() => {
    if (!open || !current) return;
    const internal = text(current.internal), external = text(current.external);
    const now = new Date(); const week = new Date(Date.now() + 7 * 864e5);
    setF({ state: current.state, audience: current.audience || 'All', internal, external,
      start: current.state === 'Scheduled' ? toLocal(current.start) : toLocal(now.toISOString()), end: current.state === 'Scheduled' ? toLocal(current.end) : toLocal(week.toISOString()) });
    setSame(!external || external === internal); setErr(null);
  }, [open, current]);

  const save = async () => {
    if (f.state !== 'Disabled' && !f.internal.trim()) return setErr('Write the reply people will receive.');
    setSaving(true); setErr(null);
    try {
      const r = await mail.oofSet(account, { state: f.state, audience: f.audience, start: f.state === 'Scheduled' ? new Date(f.start).toISOString() : undefined, end: f.state === 'Scheduled' ? new Date(f.end).toISOString() : undefined,
        internal: html(f.internal), external: html(same ? f.internal : f.external) });
      onSaved(r);
    } catch (e) { setErr(e.message); } finally { setSaving(false); }
  };

  const input = 'h-9 w-full rounded-md border border-[#d1d1d1] px-2.5 text-[13px] bg-white focus:outline-none focus:border-ol';
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg rounded-lg p-0 gap-0 max-h-[94dvh] flex flex-col">
        <DialogHeader className="px-5 pt-5 pb-3 border-b rule">
          <DialogTitle className="text-[16px]">Automatic replies</DialogTitle>
          <p className="text-[12px] text-neutral-500">{email} · set on the mail server, so it also works when nobody has the app or Outlook open.</p>
        </DialogHeader>
        {!f ? <p className="px-5 py-8 text-[13px] text-neutral-400">Loading…</p> : (
          <div className="px-5 py-4 space-y-4 overflow-y-auto">
            <div className="space-y-1.5">
              {[['Disabled', 'Off'], ['Enabled', 'On, until I turn them off'], ['Scheduled', 'On between two dates']].map(([k, l]) => (
                <label key={k} className="flex items-center gap-2 text-[13.5px] cursor-pointer"><input type="radio" name="oof" checked={f.state === k} onChange={() => setF({ ...f, state: k })} className="accent-[#0f6cbd]" /> {l}</label>
              ))}
            </div>
            {f.state === 'Scheduled' && (
              <div className="grid grid-cols-2 gap-3">
                <div><span className="text-[13px] font-semibold text-ol-text mb-1 block">From</span><input type="datetime-local" value={f.start} onChange={(e) => setF({ ...f, start: e.target.value })} className={input} /></div>
                <div><span className="text-[13px] font-semibold text-ol-text mb-1 block">Until</span><input type="datetime-local" value={f.end} min={f.start} onChange={(e) => setF({ ...f, end: e.target.value })} className={input} /></div>
              </div>
            )}
            {f.state !== 'Disabled' && <>
              <div><span className="text-[13px] font-semibold text-ol-text mb-1 block">Reply</span>
                <textarea rows={5} value={f.internal} onChange={(e) => setF({ ...f, internal: e.target.value })} placeholder="Thank you for your email. I am away until … and will reply when I am back. For anything urgent please contact …" className="w-full rounded-md border border-[#d1d1d1] px-2.5 py-2 text-[13px] focus:outline-none focus:border-ol" /></div>
              <div><span className="text-[13px] font-semibold text-ol-text mb-1 block">People outside PB Abbey</span>
                <select value={f.audience} onChange={(e) => setF({ ...f, audience: e.target.value })} className={input}>
                  <option value="All">Reply to everyone</option><option value="Known">Reply only to my contacts</option><option value="None">Don't reply to people outside</option>
                </select>
                {f.audience !== 'None' && <label className="mt-2 flex items-center gap-2 text-[13px] cursor-pointer"><input type="checkbox" checked={same} onChange={(e) => setSame(e.target.checked)} className="accent-[#0f6cbd]" /> Same message for them</label>}
                {f.audience !== 'None' && !same && <textarea rows={4} value={f.external} onChange={(e) => setF({ ...f, external: e.target.value })} placeholder="Message for people outside PB Abbey" className="mt-2 w-full rounded-md border border-[#d1d1d1] px-2.5 py-2 text-[13px] focus:outline-none focus:border-ol" />}
              </div>
            </>}
          </div>
        )}
        <div className="px-5 py-3 border-t rule flex items-center gap-3">
          <button onClick={save} disabled={!f || saving} className="h-9 px-4 rounded-md bg-ol hover:bg-ol-hover text-white text-[14px] font-semibold inline-flex items-center gap-2 disabled:opacity-50">{saving && <Loader2 className="w-4 h-4 animate-spin" />} Save</button>
          {err && <span className="text-[12px] text-red-600">{err}</span>}
          <button onClick={onClose} className="ml-auto h-9 px-3 text-[13px] text-neutral-500 hover:text-neutral-900">Cancel</button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

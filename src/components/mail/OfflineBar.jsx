/* Banner on the mail pages when the connection is gone or mail is waiting to be sent,
 * and the loop that sends the waiting mail as soon as the connection is back. */
import React, { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { WifiOff, Send, RefreshCw } from 'lucide-react';
import { isOnline, outboxItems, initOutbox, flushOutbox, removeFromOutbox } from '@/lib/offlineMail';

export default function OfflineBar() {
  const qc = useQueryClient();
  const [, tick] = useState(0);
  const [justSent, setJustSent] = useState(0);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const re = () => tick((n) => n + 1);
    window.addEventListener('pb-mail-state', re);
    const onSent = (e) => { setJustSent(e.detail?.sent || 0); qc.invalidateQueries({ queryKey: ['mail', 'list'] }); setTimeout(() => setJustSent(0), 8000); };
    window.addEventListener('pb-outbox-sent', onSent);
    initOutbox().then(() => flushOutbox());
    const id = setInterval(() => { if (outboxItems().length) flushOutbox(); }, 30000);
    return () => { window.removeEventListener('pb-mail-state', re); window.removeEventListener('pb-outbox-sent', onSent); clearInterval(id); };
  }, [qc]);

  const waiting = outboxItems();
  const failed = waiting.filter((x) => x.error);
  const offline = !isOnline();
  const retry = async () => { setBusy(true); try { await flushOutbox(); } finally { setBusy(false); } };

  if (justSent && !offline && !waiting.length) {
    return <div className="mx-2 md:ml-0 md:mr-2 mt-2 shrink-0 px-4 py-2 rounded-md bg-[#dff6dd] text-[#0e700e] text-[13px] flex items-center gap-2"><Send className="w-4 h-4 shrink-0" />{justSent === 1 ? 'The mail that was waiting has been sent.' : `${justSent} mails that were waiting have been sent.`}</div>;
  }
  if (!offline && !waiting.length) return null;
  return (
    <div className={`mx-2 md:ml-0 md:mr-2 mt-2 shrink-0 px-4 py-2 rounded-md text-[13px] flex flex-wrap items-center gap-x-3 gap-y-1 ${offline ? 'bg-[#fff4ce] text-[#5c4a00]' : 'bg-ol-soft text-ol-text'}`}>
      {offline ? <WifiOff className="w-4 h-4 shrink-0" /> : <Send className="w-4 h-4 shrink-0" />}
      <span className="min-w-0 flex-1">
        {offline ? "You're offline. You can still read the mail already loaded." : 'Connection is back.'}
        {waiting.length > 0 && <> <b>{waiting.length === 1 ? '1 mail is waiting' : `${waiting.length} mails are waiting`}</b> {offline ? 'and will be sent when the connection is back.' : 'to be sent…'}</>}
      </span>
      {waiting.length > 0 && <button onClick={retry} disabled={busy} className="h-7 px-2.5 rounded border border-current/30 inline-flex items-center gap-1.5 hover:bg-white/50"><RefreshCw className={`w-3.5 h-3.5 ${busy ? 'animate-spin' : ''}`} /> Send now</button>}
      {failed.map((x) => (
        <div key={x.id} className="basis-full text-[12px] text-red-700 flex items-center gap-2">
          “{x.payload?.subject || '(no subject)'}” could not be sent: {x.error}
          <button onClick={() => { if (confirm('Remove this mail from the waiting list? It will not be sent.')) removeFromOutbox(x.id); }} className="underline">Remove</button>
        </div>
      ))}
    </div>
  );
}

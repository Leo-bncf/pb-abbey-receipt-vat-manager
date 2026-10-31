/* Everywhere (browser and app): anything that failed because the connection dropped
 * (Wi-Fi blip, computer waking up) loads again by itself as soon as it can.
 * Only inside the PB Abbey Mail desktop app (window.pbDesktop, see pb-abbey-desktop/app/preload.cjs):
 * every minute, on any page, check both Inboxes; show a notification for each new
 * unread email and put the total unread count on the Dock / taskbar icon. A click
 * on a notification opens that mailbox. In a normal browser this does nothing. */
import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { mail } from '@/api/mailClient';

const who = (from) => { const m = String(from || '').match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>/); return (m && (m[1].trim() || m[2])) || from || 'Someone'; };

export default function DesktopBridge() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const seen = useRef({}); // account -> Set of unread ids already announced (ids may be numbers or Exchange ids)
  const desk = typeof window !== 'undefined' ? window.pbDesktop : null;

  useEffect(() => (desk ? desk.onNavigate((p) => navigate(p)) : undefined), [desk, navigate]);

  useEffect(() => {
    const retryFailed = () => qc.refetchQueries({ predicate: (q) => q.state.status === 'error' && (q.state.error?.offline || /failed to fetch|load failed|network/i.test(String(q.state.error?.message))) });
    const onVisible = () => { if (document.visibilityState === 'visible') retryFailed(); };
    window.addEventListener('online', retryFailed);
    window.addEventListener('focus', retryFailed);
    document.addEventListener('visibilitychange', onVisible);
    const id = setInterval(retryFailed, 20000);
    return () => { window.removeEventListener('online', retryFailed); window.removeEventListener('focus', retryFailed); document.removeEventListener('visibilitychange', onVisible); clearInterval(id); };
  }, [qc]);

  useEffect(() => {
    if (!desk) return undefined;
    let stop = false;
    const tick = async () => {
      try {
        const accs = (await mail.accounts()).accounts || [];
        let total = 0;
        for (const a of accs) {
          const r = await mail.list(a.id, 'INBOX', 15, 0, 'unread');
          const unread = r.messages || [];
          total += r.total ?? unread.length;
          const key = `${a.id}:${typeof unread[0]?.uid}`; // a switch of id kind starts afresh instead of announcing everything
          const known = seen.current[key];
          if (known) {
            const fresh = unread.filter((m) => !known.has(m.uid)).slice(0, 3);
            fresh.forEach((m) => desk.notify(`${who(m.from)} · ${a.label}`, m.subject || '(no subject)', `/mail?account=${encodeURIComponent(a.id)}`));
            if (fresh.length) qc.invalidateQueries({ queryKey: ['mail', 'list', a.id, 'INBOX'] });
          }
          if (unread.length) seen.current[key] = new Set([...(known || []), ...unread.map((m) => m.uid)]);
        }
        if (!stop) desk.badge(total);
      } catch { /* signed out or offline: try again next minute */ }
    };
    tick();
    const id = setInterval(tick, 60000);
    return () => { stop = true; clearInterval(id); };
  }, [desk, qc]);

  return null;
}

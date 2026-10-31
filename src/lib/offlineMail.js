/* Mail without a connection (Peter's Wi-Fi drops now and then):
 * 1. The mail already loaded (folders, lists, opened mails, contacts) is kept on this computer
 *    (IndexedDB, 7 days), so it can still be read when the connection is gone.
 * 2. A mail sent while offline waits in a local outbox and leaves by itself when the connection
 *    is back. Before sending a waiting mail again, Sent is checked: if the server had in fact
 *    received it before the line dropped, it is not sent a second time.
 * 3. A small "connection" flag that the mail pages show as a banner. */
import { get, set, del, createStore } from 'idb-keyval';
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import { mail } from '@/api/mailClient';

const store = createStore('pb-abbey-mail', 'kv');
const CACHE_KEY = 'query-cache';
const OUTBOX_KEY = 'outbox';

// ---- 1. cache of what was already loaded ----
export const mailPersister = createAsyncStoragePersister({
  storage: { getItem: (k) => get(k, store), setItem: (k, v) => set(k, v, store), removeItem: (k) => del(k, store) },
  key: CACHE_KEY,
  throttleTime: 2000,
});
const KEEP = new Set(['accounts', 'folders', 'counts', 'list', 'message', 'contacts', 'people']);
export const persistOptions = {
  persister: mailPersister,
  maxAge: 7 * 24 * 60 * 60 * 1000,
  buster: 'mail-1',
  dehydrateOptions: { shouldDehydrateQuery: (q) => q.state.status === 'success' && q.queryKey[0] === 'mail' && KEEP.has(q.queryKey[1]) },
};

// ---- 3. connection flag ----
let online = typeof navigator === 'undefined' ? true : navigator.onLine;
const emit = () => window.dispatchEvent(new Event('pb-mail-state'));
export const isOnline = () => online;
export function setOnline(v) { if (online !== v) { online = v; emit(); } }
if (typeof window !== 'undefined') {
  window.addEventListener('offline', () => setOnline(false));
  window.addEventListener('online', () => { setOnline(true); flushOutbox(); });
  // mailClient reports each call: reached the server or not (the Wi-Fi can be "connected" without internet).
  window.addEventListener('pb-net', (e) => { const was = online; setOnline(!!e.detail?.ok); if (e.detail?.ok && !was) flushOutbox(); });
}

// ---- 2. outbox ----
let outbox = [];
let loaded = false;
const load = async () => { if (!loaded) { outbox = (await get(OUTBOX_KEY, store)) || []; loaded = true; } return outbox; };
const save = async () => { await set(OUTBOX_KEY, outbox, store); emit(); };
export const outboxItems = () => outbox;
export async function initOutbox() { await load(); emit(); }

export async function addToOutbox(acc, payload) {
  await load();
  outbox = [...outbox, { id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, acc, payload, queuedAt: Date.now(), error: null }];
  await save();
}
export async function removeFromOutbox(id) { await load(); outbox = outbox.filter((x) => x.id !== id); await save(); }

// Did the server get it before the line dropped? Look for the same subject sent since it was queued.
async function alreadySent(item) {
  const sentBox = (await mail.folders(item.acc)).folders?.find((f) => f.special === 'sent')?.name || 'Sent Items';
  const r = await mail.list(item.acc, sentBox, 15, 0);
  const subj = String(item.payload.subject || '').trim();
  return (r.messages || []).some((m) => String(m.subject || '').trim() === (subj || '(no subject)') && Date.parse(m.date) >= item.queuedAt - 2 * 60e3);
}

let flushing = false;
// Send what is waiting. Returns how many left. `onSent(n)` is told how many went out.
export async function flushOutbox(onSent) {
  await load();
  if (flushing || !outbox.length) return outbox.length;
  flushing = true;
  let sent = 0;
  try {
    for (const item of [...outbox]) {
      try {
        if (!(await alreadySent(item))) await mail.send(item.acc, item.payload);
        await removeFromOutbox(item.id); sent++;
      } catch (e) {
        if (e?.offline) { setOnline(false); break; } // still no connection: try again later
        outbox = outbox.map((x) => (x.id === item.id ? { ...x, error: String(e?.message || e) } : x)); await save();
      }
    }
  } finally { flushing = false; }
  if (sent) { onSent?.(sent); window.dispatchEvent(new CustomEvent('pb-outbox-sent', { detail: { sent } })); }
  return outbox.length;
}

// Signing out: nothing of the mailbox stays on the computer.
export async function clearOfflineMail() {
  try { await del(CACHE_KEY, store); await del(OUTBOX_KEY, store); } catch { /* private mode */ }
  outbox = []; emit();
}

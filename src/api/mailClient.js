// Read/write client for the IONOS mailbox edge function (/functions/v1/mail).
// Sends the logged-in user's Supabase access token so the function can confirm
// a real user is asking (the stack runs VERIFY_JWT=false, so the function
// checks the token itself). Supports multiple mailboxes via the `account` param.
import { supabase } from './base44Client';

const BASE = import.meta.env.VITE_SUPABASE_URL;
const ANON = import.meta.env.VITE_SUPABASE_ANON_KEY;

async function authHeaders() {
  const { data: { session } } = await supabase.auth.getSession();
  return { apikey: ANON, Authorization: `Bearer ${session?.access_token ?? ANON}` };
}

function qs(params) {
  const clean = Object.fromEntries(Object.entries(params).filter(([, v]) => v != null && v !== ''));
  return new URLSearchParams(clean).toString();
}

// A dropped connection (Wi-Fi blip, computer waking from sleep) makes fetch throw a bare
// "Failed to fetch". Reads try again a few times; if the network is really gone the
// error says so in plain words and is marked `offline` so the page retries later.
export const OFFLINE_MSG = 'No connection to the mail server. Trying again…';
const isNetErr = (e) => e instanceof TypeError || /failed to fetch|load failed|network/i.test(String(e?.message));
const offlineError = () => Object.assign(new Error(OFFLINE_MSG), { offline: true });
const report = (ok) => { try { window.dispatchEvent(new CustomEvent('pb-net', { detail: { ok } })); } catch { /* no window */ } };
async function netFetch(url, opts, tries = 3) {
  for (let i = 0; ; i++) {
    try { const res = await fetch(url, opts); report(true); return res; } catch (e) {
      if (!isNetErr(e)) throw e;
      if (i >= tries - 1) { report(false); throw offlineError(); }
      await new Promise((r) => setTimeout(r, [800, 2500, 5000][i] || 5000));
    }
  }
}

async function call(params) {
  const res = await netFetch(`${BASE}/functions/v1/mail?${qs(params)}`, { headers: await authHeaders() });
  if (!res.ok) {
    let msg;
    try { msg = (await res.json()).error; } catch { msg = res.statusText; }
    throw new Error(msg || `HTTP ${res.status}`);
  }
  return res.json();
}

async function post(params, body) {
  // Writes (sending mail included) are tried once: never risk sending twice.
  const res = await netFetch(`${BASE}/functions/v1/mail?${qs(params)}`, {
    method: 'POST',
    headers: { ...(await authHeaders()), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }, 1);
  if (!res.ok) {
    let msg;
    try { msg = (await res.json()).error; } catch { msg = res.statusText; }
    throw new Error(msg || `HTTP ${res.status}`);
  }
  return res.json();
}

export const mail = {
  accounts: () => call({ action: 'accounts' }),
  folders: (account) => call({ action: 'folders', account }),
  // Unread / total per folder: all of them, or just the listed raw names.
  counts: (account) => call({ action: 'folders', account, counts: 1 }),
  countsFor: (account, names) => call({ action: 'counts', account, names: JSON.stringify(names) }),
  list: (account, mailbox = 'INBOX', limit = 40, skip = 0, filter = '') => call({ action: 'list', account, mailbox, limit, skip, filter }),
  message: (uid, account, mailbox = 'INBOX') => call({ action: 'message', uid, account, mailbox }),
  markread: (uid, account, mailbox = 'INBOX') => call({ action: 'markread', uid, account, mailbox }),
  send: (account, payload) => post({ action: 'send', account }, payload),
  // uid: one UID or an array of them.
  remove: (uid, account, mailbox = 'INBOX') => call({ action: 'delete', uid: [].concat(uid).join(','), account, mailbox }),
  archive: (uid, account, mailbox = 'INBOX') => call({ action: 'archive', uid: [].concat(uid).join(','), account, mailbox }),
  restore: (uid, account, mailbox) => call({ action: 'restore', uid: [].concat(uid).join(','), account, mailbox }),
  move: (uid, account, mailbox, dest) => call({ action: 'move', uid: [].concat(uid).join(','), account, mailbox, dest }),
  // set: 'seen' | 'unseen' | 'flagged' | 'unflagged'
  flags: (uid, account, mailbox, set) => call({ action: 'flags', uid: [].concat(uid).join(','), account, mailbox, set }),
  createFolder: (account, parent, label) => call({ action: 'createFolder', account, parent, label }),
  renameFolder: (account, folder, label) => call({ action: 'renameFolder', account, folder, label }),
  deleteFolder: (account, folder) => call({ action: 'deleteFolder', account, folder }),
  search: (q, account, mailbox = 'INBOX', body = false) => call({ action: 'search', q, account, mailbox, body: body ? 1 : null }),
  contacts: (account) => call({ action: 'contacts', account }),
  saveDraft: (account, payload) => post({ action: 'saveDraft', account }, payload),
  deleteDraft: (uid, account) => call({ action: 'deleteDraft', uid, account }),
  // Outlook calendar (Exchange) of a mailbox. from/to: ISO date-times.
  calendar: (account, from, to) => call({ action: 'calendar', account, from, to }),
  calendarCreate: (account, event) => post({ action: 'calendarCreate', account }, event),
  // series: act on the whole repeating series; notify: send the attendees a cancellation.
  calendarDelete: (account, id, { series = false, notify = false } = {}) => call({ action: 'calendarDelete', account, id, series: series ? 1 : null, notify: notify ? 1 : null }),
  calendarGet: (account, id, series = false) => call({ action: 'calendarGet', account, id, series: series ? 1 : null }),
  calendarUpdate: (account, id, event, series = false) => post({ action: 'calendarUpdate', account, id, series: series ? 1 : null }, event),
  calendarRespond: (account, id, answer, message = '') => post({ action: 'calendarRespond', account, id }, { answer, message }),
  // Exchange contacts (People).
  people: (account) => call({ action: 'people', account }),
  personSave: (account, person) => post({ action: 'personSave', account }, person),
  personDelete: (account, id) => call({ action: 'personDelete', account, id }),
  // Automatic replies (out of office).
  oofGet: (account) => call({ action: 'oofGet', account }),
  oofSet: (account, settings) => post({ action: 'oofSet', account }, settings),
  async attachmentBlob(uid, idx, account, mailbox = 'INBOX') {
    const res = await netFetch(`${BASE}/functions/v1/mail?${qs({ action: 'attachment', uid, idx, account, mailbox })}`, { headers: await authHeaders() });
    if (!res.ok) throw new Error(`Download failed (${res.status})`);
    return res.blob();
  },
  async downloadAttachment(uid, idx, filename, account, mailbox = 'INBOX') {
    const blob = await this.attachmentBlob(uid, idx, account, mailbox);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename || 'attachment';
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  },
};

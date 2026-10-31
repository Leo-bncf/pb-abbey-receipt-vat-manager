'use strict';
// PB Abbey · mail-imap sidecar — IMAP over Node's TLS (OpenSSL), because the
// IONOS Exchange server (exchange.ionos.com) only speaks TLS 1.2 and rejects
// the TLS 1.3 ClientHello that Deno/rustls sends. Internal only (docker
// network); the public, JWT-gated surface stays the `mail` edge function,
// which proxies here. Pure Node built-ins, no npm deps.
const http = require('http');
const tls = require('tls');
const ews = require('./ews');
const nodemailer = require('nodemailer');
const MailComposer = require('nodemailer/lib/mail-composer');

const PORT = Number(process.env.PORT || 8799);
const DEFAULT_HOST = process.env.IONOS_IMAP_HOST || 'exchange.ionos.eu';
const DEFAULT_PORT = Number(process.env.IONOS_IMAP_PORT || 993);
const SMTP_HOST = process.env.IONOS_SMTP_HOST || 'smtp.exchange.ionos.eu';
const SMTP_PORT = Number(process.env.IONOS_SMTP_PORT || 587);
const ACCOUNT_IDS = (process.env.MAIL_ACCOUNT_IDS || 'office,accounts').split(',').map((s) => s.trim()).filter(Boolean);

function accountEnv(id) {
  const k = id.toUpperCase().replace(/[^A-Z0-9]/g, '_');
  const user = process.env[`MAIL_${k}_USER`] || '';
  const pass = process.env[`MAIL_${k}_PASS`] || '';
  return {
    id, label: process.env[`MAIL_${k}_LABEL`] || id, email: user, user, pass,
    host: process.env[`MAIL_${k}_HOST`] || DEFAULT_HOST,
    port: Number(process.env[`MAIL_${k}_PORT`] || DEFAULT_PORT),
    configured: !!(user && pass),
  };
}
const listAccounts = () => ACCOUNT_IDS.map(accountEnv);
const getAccount = (id) => accountEnv(id && ACCOUNT_IDS.includes(id) ? id : ACCOUNT_IDS[0]);

const L1 = (b) => b.toString('latin1');
const fromL1 = (s) => Buffer.from(s, 'latin1');
const decodeText = (buf, charset) => {
  try { return new TextDecoder(charset || 'utf-8', { fatal: false }).decode(buf); }
  catch { return buf.toString('utf-8'); }
};

// ---- IMAP client over TLS 1.2-capable OpenSSL ----
class Imap {
  constructor(cfg) { this.cfg = cfg; this.buf = Buffer.alloc(0); this.tag = 0; this.waiters = []; this.closed = false; this.err = null; }
  connect() {
    return new Promise((resolve, reject) => {
      this.sock = tls.connect({ host: this.cfg.host, port: this.cfg.port, servername: this.cfg.host });
      this.sock.setTimeout(90000, () => { this.sock.destroy(new Error('timeout')); }); // IONOS can be slow on big folders
      this.sock.on('data', (d) => { this.buf = Buffer.concat([this.buf, d]); this.pump(); });
      this.sock.on('error', (e) => { this.err = e; this.rejectAll(e); reject(e); });
      this.sock.on('close', () => { this.closed = true; this.rejectAll(this.err || new Error('connection closed')); });
      this.sock.once('secureConnect', () => { this.readLine().then(resolve, reject); });
    });
  }
  pump() { while (this.waiters.length) { const w = this.waiters[0]; const r = w.fn(); if (r === undefined) break; this.waiters.shift(); w.resolve(r); } }
  rejectAll(e) { while (this.waiters.length) this.waiters.shift().reject(e); }
  want(fn) { return new Promise((resolve, reject) => { this.waiters.push({ fn, resolve, reject }); if (this.closed) this.rejectAll(this.err || new Error('closed')); else this.pump(); }); }
  readExact(n) { return this.want(() => { if (this.buf.length >= n) { const o = Buffer.from(this.buf.subarray(0, n)); this.buf = this.buf.subarray(n); return o; } return undefined; }); }
  readLine() { return this.want(() => { const i = this.buf.indexOf('\r\n'); if (i >= 0) { const o = Buffer.from(this.buf.subarray(0, i + 2)); this.buf = this.buf.subarray(i + 2); return o; } return undefined; }); }
  async command(cmd) {
    const tag = 'A' + (++this.tag);
    this.sock.write(tag + ' ' + cmd + '\r\n');
    const lines = [];
    while (true) {
      let line = await this.readLine();
      while (true) { const m = L1(line).match(/\{(\d+)\}\r\n$/); if (!m) break; const lit = await this.readExact(parseInt(m[1])); const cont = await this.readLine(); line = Buffer.concat([line, lit, cont]); }
      lines.push(line);
      const s = L1(line);
      if (s.startsWith(tag + ' ')) return { lines, ok: /^A\d+ OK/i.test(s), status: s.trim() };
    }
  }
  async authPlain() { const b64 = Buffer.from('\u0000' + this.cfg.user + '\u0000' + this.cfg.pass, 'utf8').toString('base64'); const r = await this.command('AUTHENTICATE PLAIN ' + b64); if (!r.ok) throw new Error('AUTH PLAIN: ' + r.status); }
  async loginCmd() { const esc = (v) => v.replace(/([\\"])/g, '\\$1'); const r = await this.command(`LOGIN "${esc(this.cfg.user)}" "${esc(this.cfg.pass)}"`); if (!r.ok) throw new Error('LOGIN: ' + r.status); }
  async login() { try { await this.authPlain(); return; } catch { /* fall back */ } await this.loginCmd(); }
  // Mark a message \Seen (needs a read-write SELECT, not EXAMINE).
  async markSeen(mailbox, uid) {
    const sel = await this.command(`SELECT "${mailbox}"`);
    if (!sel.ok) throw new Error('select failed: ' + sel.status);
    const r = await this.command(`UID STORE ${uid} +FLAGS (\\Seen)`);
    if (!r.ok) throw new Error('store failed: ' + r.status);
  }
  // List mailboxes: returns [{name, flags}]. Flags include \Sent, \Drafts, etc.
  async listFolders() {
    const r = await this.command('LIST "" "*"');
    const out = [];
    for (const lb of r.lines) {
      const s = L1(lb);
      const m = s.match(/^\* LIST \(([^)]*)\) (?:"([^"]*)"|NIL) (?:"([^"]*)"|([^\r\n ]+))/);
      if (m) out.push({ flags: m[1], delim: (m[2] || '/').replace(/\\(.)/g, '$1'), name: m[3] != null ? m[3].replace(/\\(.)/g, '$1') : m[4] });
    }
    return out;
  }
  // Append a raw RFC822 message (already \r\n line endings) to a folder.
  // Returns the new message's UID when the server reports it (UIDPLUS APPENDUID).
  async appendRaw(mailbox, rawBuf, flags = '(\\Seen)') {
    const tag = 'A' + (++this.tag);
    this.sock.write(`${tag} APPEND "${mailbox}" ${flags} {${rawBuf.length}}\r\n`);
    const cont = await this.readLine(); // expect "+ ..."
    if (!L1(cont).startsWith('+')) throw new Error('append not accepted: ' + L1(cont).trim());
    this.sock.write(rawBuf); this.sock.write('\r\n');
    while (true) {
      const line = await this.readLine(); const s = L1(line);
      if (s.startsWith(tag + ' ')) {
        if (!/^A\d+ OK/i.test(s)) throw new Error('append failed: ' + s.trim());
        const m = s.match(/APPENDUID \d+ (\d+)/i); return m ? Number(m[1]) : null;
      }
    }
  }
  async selectRW(mailbox) { const r = await this.command(`SELECT "${mailbox}"`); if (!r.ok) throw new Error('select failed: ' + r.status); }
  // Move one message (UID) to another folder; falls back to COPY + delete.
  async moveUid(mailbox, uid, dest) {
    await this.selectRW(mailbox);
    const mv = await this.command(`UID MOVE ${uid} "${dest}"`);
    if (mv.ok) return;
    const cp = await this.command(`UID COPY ${uid} "${dest}"`);
    if (!cp.ok) throw new Error('move failed: ' + cp.status);
    await this.command(`UID STORE ${uid} +FLAGS.SILENT (\\Deleted)`);
    await this.command(`UID EXPUNGE ${uid}`);
  }
  // Permanently remove one message (UID) from a folder.
  async expungeUid(mailbox, uid) {
    await this.selectRW(mailbox);
    await this.command(`UID STORE ${uid} +FLAGS.SILENT (\\Deleted)`);
    const r = await this.command(`UID EXPUNGE ${uid}`);
    if (!r.ok) throw new Error('delete failed: ' + r.status);
  }
  // Find a folder by special-use flag (e.g. \\Trash) or, failing that, by name.
  async findFolder(flagRe, nameRe) {
    const all = await this.listFolders();
    return (all.find((f) => flagRe && flagRe.test(f.flags)) || all.find((f) => nameRe && nameRe.test(f.name)) || {}).name || null;
  }
  logout() { try { this.sock.write('AZ LOGOUT\r\n'); } catch { /* */ } try { this.sock.destroy(); } catch { /* */ } }
}

// ---- RFC 2047 + encodings ----
function decodeQP(buf) {
  const s = L1(buf); let out = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '=') {
      if (s.substr(i + 1, 2) === '\r\n') { i += 2; continue; }
      if (s[i + 1] === '\n') { i += 1; continue; }
      const hex = s.substr(i + 1, 2);
      if (/^[0-9A-Fa-f]{2}$/.test(hex)) { out += String.fromCharCode(parseInt(hex, 16)); i += 2; continue; }
      out += c;
    } else out += c;
  }
  return fromL1(out);
}
function decodeWord(str) {
  if (!str) return str;
  // RFC 2047 §6.2: whitespace between two adjacent encoded-words is not displayed.
  return str.replace(/(\?=)\s+(?==\?)/g, '$1').replace(/=\?([^?]+)\?([bBqQ])\?([^?]*)\?=/g, (m, cs, enc, txt) => {
    try {
      const bytes = enc.toUpperCase() === 'B' ? Buffer.from(txt.replace(/\s+/g, ''), 'base64') : decodeQP(fromL1(txt.replace(/_/g, ' ')));
      return decodeText(bytes, cs);
    } catch { return m; }
  });
}

// ---- MIME ----
function splitHeaderBody(buf) {
  const i = buf.indexOf('\r\n\r\n');
  return i >= 0 ? [buf.subarray(0, i), buf.subarray(i + 4)] : [buf, Buffer.alloc(0)];
}
function parseHeaders(hbuf) {
  const unfolded = L1(hbuf).replace(/\r\n[ \t]+/g, ' ');
  const h = {};
  for (const ln of unfolded.split(/\r\n/)) { const idx = ln.indexOf(':'); if (idx > 0) { const k = ln.slice(0, idx).trim().toLowerCase(); const v = ln.slice(idx + 1).trim(); h[k] = h[k] ? h[k] + '; ' + v : v; } }
  return h;
}
const getParam = (hv, name) => { const m = hv.match(new RegExp(name + '\\s*=\\s*"([^"]*)"', 'i')) || hv.match(new RegExp(name + '\\s*=\\s*([^;\\s]+)', 'i')); return m ? m[1] : null; };
function decodeCTE(buf, cte) {
  if (cte === 'base64') { try { return Buffer.from(L1(buf).replace(/\s+/g, ''), 'base64'); } catch { return buf; } }
  if (cte === 'quoted-printable') return decodeQP(buf);
  return buf;
}
function splitMultipart(body, boundary) {
  const segs = L1(body).split('--' + boundary);
  const out = [];
  for (let i = 1; i < segs.length; i++) { let seg = segs[i]; if (seg.startsWith('--')) break; seg = seg.replace(/^\r\n/, '').replace(/\r\n$/, ''); if (seg.length) out.push(fromL1(seg)); }
  return out;
}
function parsePart(buf) {
  const [hb, body] = splitHeaderBody(buf);
  const h = parseHeaders(hb);
  const ctRaw = h['content-type'] || 'text/plain';
  const ct = ctRaw.toLowerCase();
  const cte = (h['content-transfer-encoding'] || '7bit').toLowerCase();
  const disp = h['content-disposition'] || '';
  if (ct.startsWith('multipart/')) {
    const boundary = getParam(ctRaw, 'boundary');
    if (!boundary) return { multipart: false, contentType: 'text/plain', filename: null, isAttach: false, bytes: body, charset: 'utf-8' };
    return { multipart: true, parts: splitMultipart(body, boundary).map(parsePart) };
  }
  const decoded = decodeCTE(body, cte);
  const filename = getParam(ctRaw, 'name') || getParam(disp, 'filename');
  const type = ct.split(';')[0].trim();
  const isAttach = /attachment/i.test(disp) || (!!filename && !type.startsWith('text/'));
  return { multipart: false, contentType: type, filename: filename ? decodeWord(filename) : null, isAttach, bytes: decoded, charset: getParam(ctRaw, 'charset'), cid: (h['content-id'] || '').replace(/[<>\s]/g, '') || null };
}

// ---- actions ----
// Parse "* n FETCH (UID … FLAGS … BODY[HEADER.FIELDS (DATE FROM SUBJECT)] {n} …)" lines.
function parseHeaderFetch(lines) {
  const msgs = [];
  for (const lb of lines) {
    const s = L1(lb);
    if (!/^\* \d+ FETCH /.test(s)) continue;
    const uid = (s.match(/UID (\d+)/) || [])[1];
    const flags = (s.match(/FLAGS \(([^)]*)\)/) || [])[1] || '';
    const size = Number((s.match(/RFC822\.SIZE (\d+)/) || [])[1] || 0);
    const hm = s.match(/BODY\[HEADER\.FIELDS[^\]]*\] \{(\d+)\}\r\n/);
    let from = '', subject = '', date = '', attach = false, important = false;
    if (hm) {
      const h = parseHeaders(fromL1(s.substr(hm.index + hm[0].length, parseInt(hm[1]))));
      from = decodeWord(h['from'] || ''); subject = decodeWord(h['subject'] || '(no subject)'); date = h['date'] || '';
      attach = /multipart\/mixed/i.test(h['content-type'] || ''); // has real attachments (inline-only mail is multipart/related)
      important = /high/i.test(h['importance'] || '') || /^\s*[12]\b/.test(h['x-priority'] || '');
    }
    msgs.push({ uid: Number(uid), from, subject, date, size, attach, important, seen: /\\Seen/.test(flags), flagged: /\\Flagged/.test(flags), answered: /\\Answered/.test(flags) });
  }
  return msgs;
}

// IMAP string argument: quoted for ASCII, non-synchronising literal (LITERAL+) otherwise.
function imapArg(v) {
  const str = String(v);
  if (/^[\x20-\x7e]*$/.test(str)) return `"${str.replace(/([\\"])/g, '\\$1')}"`;
  return `{${Buffer.byteLength(str, 'utf8')}+}\r\n${str}`;
}

// IMAP folder names are "modified UTF-7" (RFC 3501 §5.1.3): "&AMk-l&AOk-ments" = "Éléments".
function utf7Decode(s) {
  return String(s).replace(/&([^-]*)-/g, (_, b) => {
    if (!b) return '&';
    const buf = Buffer.from(b.replace(/,/g, '/'), 'base64'); let o = '';
    for (let i = 0; i + 1 < buf.length; i += 2) o += String.fromCharCode((buf[i] << 8) | buf[i + 1]);
    return o;
  });
}
function utf7Encode(s) {
  return String(s).replace(/&/g, '&-').replace(/[^\x20-\x7e]+/g, (run) => {
    const b = Buffer.alloc(run.length * 2);
    for (let i = 0; i < run.length; i++) b.writeUInt16BE(run.charCodeAt(i), i * 2);
    return '&' + b.toString('base64').replace(/=+$/, '').replace(/\//g, ',') + '-';
  }).replace(/&--/g, '&-');
}
const qbox = (name) => `"${String(name).replace(/([\\"])/g, '\\$1')}"`;
// Exchange lists its calendar/contacts/tasks/notes folders over IMAP too: not mail, hide them.
const NON_MAIL = /^(calendar|calendrier|contacts|journal|notes|t[aâ]ches|tasks|sync issues|probl[eè]mes de synchronisation|conversation history|historique des conversations|rss feeds|flux rss|outbox|bo[iî]te d'envoi)(\/|$)/i;
function specialOf(f) {
  const n = utf7Decode(f.name);
  if (/^inbox$/i.test(f.name)) return 'inbox';
  if (/\\Drafts/i.test(f.flags) || /^(drafts|brouillons)$/i.test(n)) return 'drafts';
  if (/\\Sent/i.test(f.flags) || /^(sent items|sent|éléments envoyés)$/i.test(n)) return 'sent';
  if (/\\Trash/i.test(f.flags) || /^(deleted items|trash|éléments supprimés)$/i.test(n)) return 'trash';
  if (/\\Junk/i.test(f.flags) || /^(junk e-?mail|junk|courrier indésirable)$/i.test(n)) return 'junk';
  if (/\\Archive/i.test(f.flags) || /^archives?$/i.test(n)) return 'archive';
  return null;
}
// Mail folders only, with readable names and their place in the tree.
async function mailFolders(imap) {
  return (await imap.listFolders()).filter((f) => !NON_MAIL.test(utf7Decode(f.name)) && !/\\Noselect|\\NonExistent/i.test(f.flags)).map((f) => {
    const path = utf7Decode(f.name); const parts = path.split(f.delim);
    return { name: f.name, flags: f.flags, delim: f.delim, path, label: /^inbox$/i.test(path) ? 'Inbox' : parts[parts.length - 1], depth: parts.length - 1,
      parent: parts.length > 1 ? f.name.split(f.delim).slice(0, -1).join(f.delim) : null, special: specialOf(f) };
  });
}
// Unread / total per folder (one STATUS each).
async function folderCounts(imap, names, acc) {
  if (acc && process.env.MAIL_ENGINE === 'ews') {
    try {
      const all = await ews.folderCountsEws(acc); const out = {};
      for (const n of names) { const c = all.get(utf7Decode(n).toLowerCase()); if (c) out[n] = c; }
      return out;
    } catch (e) { console.error('ews counts failed, using imap:', e.message); }
  }
  const out = {};
  for (const n of names) {
    const r = await imap.command(`STATUS ${qbox(n)} (MESSAGES UNSEEN)`);
    for (const l of r.lines) { const s = L1(l); const m = s.match(/MESSAGES (\d+)/), u = s.match(/UNSEEN (\d+)/); if (m) out[n] = { total: +m[1], unread: u ? +u[1] : 0 }; }
  }
  return out;
}
const uidSet = (v) => String(v || '').split(',').map(Number).filter((n) => n > 0);

// Search subject / sender / recipient (and body when asked). Newest first, max `limit`.
async function searchMessages(imap, mailbox, q, limit, inBody) {
  const ex = await imap.command(`EXAMINE "${mailbox}"`);
  if (!ex.ok) throw new Error('mailbox select failed: ' + ex.status);
  // Exchange only accepts US-ASCII search terms (UTF-8 -> BADCHARSET). For accented
  // words search the longest unaccented run: "identité" -> "identit" still matches.
  if (!/^[\x20-\x7e]*$/.test(q)) {
    const runs = q.split(/[^\x20-\x7e]+/).map((x) => x.trim()).sort((x, y) => y.length - x.length);
    if (!runs[0] || runs[0].length < 2) throw new Error('search without accents (e.g. "identite")');
    q = runs[0];
  }
  const a = imapArg(q);
  const charset = '';
  const crit = inBody ? `OR OR OR SUBJECT ${a} FROM ${a} TO ${a} BODY ${a}` : `OR OR SUBJECT ${a} FROM ${a} TO ${a}`;
  const r = await imap.command(`UID SEARCH ${charset}${crit}`);
  if (!r.ok) throw new Error('search failed: ' + r.status);
  const uids = [];
  for (const l of r.lines) { const m = L1(l).match(/^\* SEARCH ?(.*)$/m); if (m) uids.push(...m[1].trim().split(/\s+/).filter(Boolean).map(Number)); }
  const pick = uids.sort((x, y) => y - x).slice(0, limit);
  if (!pick.length) return { mailbox, total: 0, matches: 0, messages: [] };
  const f = await imap.command(`UID FETCH ${pick.join(',')} (UID FLAGS RFC822.SIZE BODY.PEEK[HEADER.FIELDS (DATE FROM SUBJECT CONTENT-TYPE IMPORTANCE X-PRIORITY)])`);
  const msgs = parseHeaderFetch(f.lines).sort((x, y) => y.uid - x.uid);
  return { mailbox, total: uids.length, matches: uids.length, messages: msgs };
}

// Address book from recent correspondence: senders of the inbox + recipients of Sent.
const contactCache = new Map(); // account -> { at, data }
const peopleCache = new Map(); // account -> { at, data } (Exchange contacts, 1 minute)
function addrList(str) {
  const out = []; const re = /(?:"?([^"<,]*?)"?\s*)?<([^>\s]+@[^>\s]+)>|([^\s,<>"]+@[^\s,<>"]+)/g; let m;
  while ((m = re.exec(str || ''))) out.push({ name: (m[1] || '').trim(), email: (m[2] || m[3]).toLowerCase() });
  return out;
}
async function collectContacts(imap, self) {
  const tally = new Map();
  const add = (list) => list.forEach(({ name, email }) => {
    if (!email || email === self.toLowerCase() || /no-?reply|noreply|notifications?@|mailer-daemon/i.test(email)) return;
    const c = tally.get(email) || { email, name: '', count: 0 }; c.count += 1; if (name && !c.name) c.name = name; tally.set(email, c);
  });
  const grab = async (mailbox, fields, n) => {
    const ex = await imap.command(`EXAMINE "${mailbox}"`); if (!ex.ok) return;
    let exists = 0; for (const l of ex.lines) { const m = L1(l).match(/\* (\d+) EXISTS/); if (m) exists = parseInt(m[1]); }
    if (!exists) return;
    const r = await imap.command(`FETCH ${Math.max(1, exists - n + 1)}:${exists} (BODY.PEEK[HEADER.FIELDS (${fields})])`);
    for (const lb of r.lines) {
      const s = L1(lb); const hm = s.match(/BODY\[HEADER\.FIELDS[^\]]*\] \{(\d+)\}\r\n/); if (!hm) continue;
      const h = parseHeaders(fromL1(s.substr(hm.index + hm[0].length, parseInt(hm[1]))));
      add(addrList(decodeWord(Object.values(h).join(', '))));
    }
  };
  await grab('INBOX', 'FROM', 400);
  const sent = await imap.findFolder(/\\Sent/i, /^sent( items)?$/i);
  if (sent) await grab(sent, 'TO CC', 250);
  return [...tally.values()].sort((a, b) => b.count - a.count).slice(0, 400);
}

// Newest first by date received (Exchange has no SORT, and mail filed into a folder later
// gets a higher number), paged with `skip` for "Load older mail".
async function listMessages(imap, mailbox, limit, skip = 0, filter = '') {
  const ex = await imap.command(`EXAMINE ${qbox(mailbox)}`);
  if (!ex.ok) throw new Error('mailbox select failed: ' + ex.status);
  let exists = 0;
  for (const l of ex.lines) { const m = L1(l).match(/\* (\d+) EXISTS/); if (m) exists = parseInt(m[1]); }
  if (exists === 0 || skip >= exists) return { mailbox, total: exists, messages: [], more: false };
  // Filters (Outlook's "Unread" / "Flagged"): narrow to the matching UIDs first.
  let d;
  if (filter === 'unread' || filter === 'flagged') {
    const sr = await imap.command(`UID SEARCH ${filter === 'unread' ? 'UNSEEN' : 'FLAGGED'}`);
    const uids = []; for (const l of sr.lines) { const m = L1(l).match(/^\* SEARCH ?(.*)$/m); if (m) uids.push(...m[1].trim().split(/\s+/).filter(Boolean)); }
    if (!uids.length) return { mailbox, total: 0, messages: [], more: false, filter };
    d = await imap.command(`UID FETCH ${uids.join(',')} (UID INTERNALDATE)`);
  } else {
    // Only the newest part of the folder: dating all of a 7,000-mail Sent folder took IONOS
    // over 30 s. Mail filed later can sit a little out of order, hence the margin of 400.
    const from = Math.max(1, exists - (skip + limit + 400) + 1);
    d = await imap.command(`FETCH ${from}:${exists} (UID INTERNALDATE)`);
  }
  const all = [];
  for (const l of d.lines) { const s = L1(l); const u = s.match(/UID (\d+)/), t = s.match(/INTERNALDATE "([^"]+)"/); if (u) all.push({ uid: +u[1], t: t ? Date.parse(t[1].replace(/^(\d+)-(\w+)-(\d+) /, '$2 $1 $3 ')) || 0 : 0 }); }
  all.sort((a, b) => b.t - a.t || b.uid - a.uid);
  const page = all.slice(skip, skip + limit);
  if (filter) exists = all.length;
  if (!page.length) return { mailbox, total: exists, messages: [], more: false };
  const more = filter ? skip + limit < all.length : skip + limit < exists;
  const r = await imap.command(`UID FETCH ${page.map((x) => x.uid).join(',')} (UID FLAGS RFC822.SIZE BODY.PEEK[HEADER.FIELDS (DATE FROM SUBJECT CONTENT-TYPE IMPORTANCE X-PRIORITY)])`);
  const byUid = new Map(parseHeaderFetch(r.lines).map((m) => [m.uid, m]));
  return { mailbox, total: exists, messages: page.map((x) => byUid.get(x.uid)).filter(Boolean), more };
}
async function fetchRaw(imap, mailbox, uid) {
  await imap.command(`EXAMINE "${mailbox}"`);
  const r = await imap.command(`UID FETCH ${uid} (BODY.PEEK[])`);
  for (const lb of r.lines) { const s = L1(lb); const m = s.match(/BODY\[\] \{(\d+)\}\r\n/); if (m) return Buffer.from(lb.subarray(m.index + m[0].length, m.index + m[0].length + parseInt(m[1]))); }
  return null;
}
function assembleMessage(raw) {
  const acc = { html: '', text: '', attachments: [] };
  const images = []; // parts with a Content-ID: pictures shown inside the HTML (cid: links)
  const walk = (p) => {
    if (p.multipart) { p.parts.forEach(walk); return; }
    if (p.cid && /^image\//.test(p.contentType)) images.push(p);
    if (p.isAttach && p.filename) { acc.attachments.push({ filename: p.filename, contentType: p.contentType, size: p.bytes.length, cid: p.cid || null }); return; }
    const txt = decodeText(p.bytes, p.charset);
    if (p.contentType === 'text/html') acc.html = acc.html || txt;
    else if (p.contentType === 'text/plain') acc.text = acc.text || txt;
  };
  walk(parsePart(raw));
  // Inline pictures: swap cid: links for data: URLs (up to 8 MB), and hide them from the attachment chips.
  if (acc.html && images.length) {
    let budget = 8 * 1024 * 1024;
    for (const im of images) {
      const re = new RegExp(`cid:${im.cid.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'gi');
      if (!re.test(acc.html) || im.bytes.length > budget) continue;
      budget -= im.bytes.length;
      acc.html = acc.html.replace(re, `data:${im.contentType};base64,${im.bytes.toString('base64')}`);
      acc.attachments.forEach((a) => { if (a.cid === im.cid) a.inline = true; });
    }
  }
  const h = parseHeaders(splitHeaderBody(raw)[0]);
  return { important: /high/i.test(h['importance'] || '') || /^\s*[12]\b/.test(h['x-priority'] || ''), receiptTo: h['disposition-notification-to'] || '', from: decodeWord(h['from'] || ''), to: decodeWord(h['to'] || ''), cc: decodeWord(h['cc'] || ''), message_id: h['message-id'] || '', subject: decodeWord(h['subject'] || '(no subject)'), date: h['date'] || '', html: acc.html, text: acc.text, attachments: acc.attachments };
}

// ---- SMTP send (nodemailer, STARTTLS) + save-to-Sent (IMAP APPEND) ----
const toArr = (x) => Array.isArray(x) ? x.filter(Boolean) : (x ? String(x).split(/[,;]+/).map((s) => s.trim()).filter(Boolean) : []);

async function sendMail(acc, p) {
  const opts = {
    from: acc.email, to: toArr(p.to), cc: toArr(p.cc), bcc: toArr(p.bcc),
    subject: p.subject || '', text: p.text || undefined, html: p.html || undefined,
    inReplyTo: p.inReplyTo || undefined, references: p.references || undefined,
    attachDataUrls: true, // images pasted into the body travel as inline attachments
    // MailComposer ignores nodemailer's `priority`, so write the headers Outlook reads.
    headers: {
      ...(p.importance === 'high' ? { 'X-Priority': '1 (Highest)', 'X-MSMail-Priority': 'High', Importance: 'High' } : {}),
      ...(p.importance === 'low' ? { 'X-Priority': '5 (Lowest)', 'X-MSMail-Priority': 'Low', Importance: 'Low' } : {}),
      ...(p.readReceipt ? { 'Disposition-Notification-To': acc.email, 'Return-Receipt-To': acc.email } : {}),
    },
  };
  if (opts.to.length === 0) throw new Error('at least one recipient is required');
  // Attachments picked in the compose window (base64 from the browser).
  const atts = (Array.isArray(p.attachments) ? p.attachments : [])
    .filter((a) => a && a.filename && a.content_base64)
    .map((a) => ({ filename: String(a.filename), contentType: a.contentType || 'application/octet-stream', content: Buffer.from(a.content_base64, 'base64') }));
  // Forward: re-attach the original message's attachments.
  if (p.forward_from && ews.isEwsId(String(p.forward_from.uid || ''))) {
    const raw = await ews.getMime(acc, String(p.forward_from.uid));
    if (raw) { const walk = (part) => { if (part.multipart) part.parts.forEach(walk); else if (part.isAttach && part.filename) atts.push({ filename: part.filename, contentType: part.contentType, content: part.bytes }); }; walk(parsePart(raw)); }
  } else if (p.forward_from && p.forward_from.uid) {
    const im = new Imap({ host: acc.host, port: acc.port, user: acc.user, pass: acc.pass });
    try {
      await im.connect(); await im.login();
      const raw = await fetchRaw(im, p.forward_from.mailbox || 'INBOX', Number(p.forward_from.uid));
      if (raw) {
        const walk = (part) => { if (part.multipart) part.parts.forEach(walk); else if (part.isAttach && part.filename) atts.push({ filename: part.filename, contentType: part.contentType, content: part.bytes }); };
        walk(parsePart(raw));
      }
    } finally { im.logout(); }
  }
  const total = atts.reduce((n, a) => n + a.content.length, 0);
  if (total > 20 * 1024 * 1024) throw new Error(`attachments too large (${(total / 1048576).toFixed(1)} MB, max 20 MB)`);
  if (atts.length) opts.attachments = atts;
  // Build the raw MIME once so we can both send it and append it to Sent.
  const raw = await new Promise((resolve, reject) =>
    new MailComposer(opts).compile().build((err, msg) => (err ? reject(err) : resolve(msg))));
  const transport = nodemailer.createTransport({
    host: SMTP_HOST, port: SMTP_PORT, secure: false, requireTLS: true,
    auth: { user: acc.user, pass: acc.pass }, tls: { servername: SMTP_HOST },
  });
  await transport.sendMail({ envelope: { from: acc.email, to: [...opts.to, ...opts.cc, ...opts.bcc] }, raw });
  // Best-effort copy into the Sent folder (so it shows like Outlook).
  let savedToSent = false;
  try {
    const imap = new Imap({ host: acc.host, port: acc.port, user: acc.user, pass: acc.pass });
    await imap.connect(); await imap.login();
    const folders = await imap.listFolders();
    const sent = folders.find((f) => /\\Sent/i.test(f.flags)) || folders.find((f) => /^sent items$/i.test(f.name)) || folders.find((f) => /^sent$/i.test(f.name));
    if (sent) { await imap.appendRaw(sent.name, Buffer.isBuffer(raw) ? raw : Buffer.from(raw)); savedToSent = true; }
    if (p.draft_uid && ews.isEwsId(String(p.draft_uid))) { try { await ews.deleteMail(acc, [String(p.draft_uid)], true); } catch { /* ignore */ } }
    else if (p.draft_uid) { const df = await draftsFolder(imap); if (df) { try { await imap.expungeUid(df, Number(p.draft_uid)); } catch { /* ignore */ } } }
    imap.logout();
  } catch { /* send already succeeded; Sent copy is best-effort */ }
  return { ok: true, savedToSent };
}

// ---- drafts (stored in the mailbox's Drafts folder, so Outlook sees them too) ----
const draftsFolder = (imap) => imap.findFolder(/\\Drafts/i, /^(drafts|brouillons)$/i);
async function saveDraft(imap, acc, p) {
  const opts = { from: acc.email, to: toArr(p.to), cc: toArr(p.cc), bcc: toArr(p.bcc), subject: p.subject || '',
    html: p.html || undefined, text: p.text || undefined, inReplyTo: p.inReplyTo || undefined, references: p.references || undefined, keepBcc: true };
  const raw = await new Promise((resolve, reject) => new MailComposer(opts).compile().build((e, m) => (e ? reject(e) : resolve(m))));
  const folder = await draftsFolder(imap);
  if (!folder) throw new Error('no Drafts folder on this mailbox');
  const uid = await imap.appendRaw(folder, raw, '(\\Draft \\Seen)');
  // Replace the previous autosave of this draft (append first, so nothing is ever lost).
  if (p.replace_uid && ews.isEwsId(String(p.replace_uid))) { try { await ews.deleteMail(acc, [String(p.replace_uid)], true); } catch { /* already gone */ } }
  else if (p.replace_uid && Number(p.replace_uid) !== uid) { try { await imap.expungeUid(folder, Number(p.replace_uid)); } catch { /* already gone */ } }
  return { ok: true, uid, mailbox: folder };
}

// ---- Alert when a mail could not be sent (so Leo knows before Peter has to call) ----
// Sent from the OTHER mailbox, in case the failing one is the problem. At most one alert per 10 minutes.
// Says who it was for and the subject + error, never the text of the mail.
const ALERT_TO = process.env.MAIL_ALERT_TO || '';
let lastAlert = 0;
function sendFailAlert(acc, p, err) {
  if (/recipient is required|attachments too large/i.test(String(err && err.message))) return; // a mistake in the mail, not a breakdown
  if (!ALERT_TO || Date.now() - lastAlert < 10 * 60e3) return;
  lastAlert = Date.now();
  const via = listAccounts().find((x) => x.configured && x.id !== acc.id) || acc;
  const text = `PB Abbey Mail could not send a mail from ${acc.email}.\n\nTo: ${toArr(p && p.to).join(', ') || '(none)'}\nSubject: ${(p && p.subject) || '(no subject)'}\nError: ${String(err && err.message || err)}\nTime: ${new Date().toISOString()}\n\nThe app showed "Not sent" and kept the mail open, so it can be sent again.`;
  nodemailer.createTransport({ host: SMTP_HOST, port: SMTP_PORT, secure: false, requireTLS: true, auth: { user: via.user, pass: via.pass }, tls: { servername: SMTP_HOST } })
    .sendMail({ from: via.email, to: ALERT_TO, subject: `PB Abbey Mail: a mail from ${acc.email} was NOT sent`, text })
    .catch((e2) => console.error('send-fail alert could not be sent:', e2.message));
  console.error('send failed for', acc.email, String(err && err.message || err));
}

// ---- HTTP ----
const send = (res, status, obj) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
const readBody = (req) => new Promise((resolve) => { let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => { try { resolve(b ? JSON.parse(b) : {}); } catch { resolve({}); } }); });

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const action = url.searchParams.get('action') || 'list';

  if (action === 'ping') return send(res, 200, { ok: true, host: DEFAULT_HOST, port: DEFAULT_PORT, accounts: listAccounts().map((a) => ({ id: a.id, label: a.label, email: a.email, configured: a.configured })) });
  if (action === 'accounts') return send(res, 200, { accounts: listAccounts().map((a) => ({ id: a.id, label: a.label, email: a.email, configured: a.configured })) });

  if (action === 'selftest') {
    const imap = new Imap({ host: DEFAULT_HOST, port: DEFAULT_PORT, user: '', pass: '' });
    try { await imap.connect(); const cap = await imap.command('CAPABILITY'); return send(res, 200, { ok: true, host: DEFAULT_HOST, capability: L1(cap.lines[0] || Buffer.alloc(0)).trim() }); }
    catch (e) { return send(res, 502, { ok: false, host: DEFAULT_HOST, error: String(e) }); }
    finally { imap.logout(); }
  }
  if (action === 'logintest') {
    const a = getAccount(url.searchParams.get('account'));
    if (!a.configured) return send(res, 200, { account: a.id, ok: false, error: 'not configured' });
    const imap = new Imap({ host: a.host, port: a.port, user: a.user, pass: a.pass });
    const out = { account: a.id, email: a.email, ok: false };
    try { await imap.connect(); const cap = await imap.command('CAPABILITY'); out.capability = L1(cap.lines[0] || Buffer.alloc(0)).trim(); try { await imap.authPlain(); out.plain = 'ok'; out.ok = true; } catch (e) { out.plain = String(e); } if (!out.ok) { try { await imap.loginCmd(); out.login = 'ok'; out.ok = true; } catch (e) { out.login = String(e); } } }
    catch (e) { out.error = String(e); }
    finally { imap.logout(); }
    return send(res, 200, out);
  }

  const a = getAccount(url.searchParams.get('account'));
  if (!a.configured) return send(res, 503, { error: 'mailbox not configured' });

  // Send runs its own connections (SMTP + a short IMAP append) — handle before
  // opening the shared read connection below.
  if (action === 'send') {
    const body = await readBody(req);
    try { return send(res, 200, await sendMail(a, body)); }
    catch (e) { sendFailAlert(a, body, e); return send(res, 500, { error: String(e && e.message || e) }); }
  }

  // Calendar (Exchange EWS) — no IMAP connection needed.
  // People (Exchange contacts) and automatic replies — EWS, no IMAP connection.
  if (['people', 'personSave', 'personDelete', 'oofGet', 'oofSet'].includes(action)) {
    try {
      if (action === 'people') { const hit = peopleCache.get(a.id); if (hit && Date.now() - hit.at < 60e3) return send(res, 200, { contacts: hit.data }); const data = await ews.listContacts(a); peopleCache.set(a.id, { at: Date.now(), data }); return send(res, 200, { contacts: data }); }
      if (action === 'personSave') { peopleCache.delete(a.id); return send(res, 200, await ews.saveContact(a, await readBody(req))); }
      if (action === 'personDelete') { peopleCache.delete(a.id); return send(res, 200, await ews.deleteContact(a, url.searchParams.get('id'))); }
      if (action === 'oofGet') return send(res, 200, await ews.getOof(a));
      return send(res, 200, await ews.setOof(a, await readBody(req)));
    } catch (e) { return send(res, 502, { error: String(e && e.message || e) }); }
  }
  if (/^calendar/.test(action)) {
    try {
      if (action === 'calendar') {
        const from = url.searchParams.get('from'), to = url.searchParams.get('to');
        if (!from || !to) return send(res, 400, { error: 'from and to required' });
        return send(res, 200, { account: a.id, email: a.email, events: await ews.listEvents(a, from, to) });
      }
      const id = url.searchParams.get('id'); const series = url.searchParams.get('series') === '1';
      if (action === 'calendarCreate') return send(res, 200, await ews.createEvent(a, await readBody(req)));
      if (action === 'calendarGet') return send(res, 200, await ews.getEvent(a, id, series));
      if (action === 'calendarUpdate') return send(res, 200, await ews.updateEvent(a, id, await readBody(req), series));
      if (action === 'calendarRespond') { const b = await readBody(req); return send(res, 200, await ews.respondEvent(a, id, b.answer, b.message)); }
      if (action === 'calendarDelete') return send(res, 200, await ews.deleteEvent(a, id, { series, notify: url.searchParams.get('notify') === '1' }));
      return send(res, 400, { error: 'unknown calendar action' });
    } catch (e) { return send(res, 502, { error: String(e && e.message || e) }); }
  }

  const mailbox = url.searchParams.get('mailbox') || 'INBOX';

  // ---- Exchange (EWS) path: ~30x faster than IMAP on IONOS. With MAIL_ENGINE=ews (or engine=ews)
  // lists and searches come from EWS and give Exchange ids; any action given such an id runs here.
  // Numeric ids (from IMAP lists, e.g. a page left open across the switch) still go to IMAP below.
  const useEws = (url.searchParams.get('engine') || process.env.MAIL_ENGINE) === 'ews';
  const idList = String(url.searchParams.get('uid') || '').split(',').filter(Boolean);
  const ewsIds = idList.filter(ews.isEwsId);
  const box = utf7Decode(mailbox);
  const lim = () => Math.min(100, Math.max(1, Number(url.searchParams.get('limit') || 30)));
  try {
    if (action === 'list' && useEws) {
      try { return send(res, 200, await ews.listMail(a, box, mailbox, lim(), Math.max(0, Number(url.searchParams.get('skip') || 0)), url.searchParams.get('filter') || '')); }
      catch (e) { console.error('ews list failed, using imap:', e.message); }
    }
    if (action === 'search' && useEws) {
      const q = (url.searchParams.get('q') || '').trim(); if (q.length < 2) return send(res, 400, { error: 'type at least 2 characters' });
      try { return send(res, 200, await ews.searchMail(a, box, mailbox, q.slice(0, 120), 60, url.searchParams.get('body') === '1')); }
      catch (e) { console.error('ews search failed, using imap:', e.message); }
    }
    if (action === 'contacts' && useEws) {
      const hit = contactCache.get(a.id);
      if (hit && Date.now() - hit.at < 10 * 60 * 1000) return send(res, 200, { contacts: hit.data, cached: true });
      try { const data = await ews.collectContactsEws(a, a.email); contactCache.set(a.id, { at: Date.now(), data }); return send(res, 200, { contacts: data }); }
      catch (e) { console.error('ews contacts failed, using imap:', e.message); }
    }
    if (ewsIds.length) {
      if (action === 'message' || action === 'attachment') {
        const raw = await ews.getMime(a, ewsIds[0]); if (!raw) return send(res, 404, { error: 'message not found' });
        if (action === 'message') return send(res, 200, assembleMessage(raw));
        const atts = []; const walk = (p) => { if (p.multipart) p.parts.forEach(walk); else if (p.isAttach && p.filename) atts.push(p); }; walk(parsePart(raw));
        const at = atts[Number(url.searchParams.get('idx'))]; if (!at) return send(res, 404, { error: 'attachment not found' });
        res.writeHead(200, { 'Content-Type': at.contentType || 'application/octet-stream', 'Content-Disposition': `attachment; filename="${(at.filename || 'file').replace(/"/g, '')}"` });
        return res.end(at.bytes);
      }
      if (action === 'markread') { await ews.setFlags(a, ewsIds.slice(0, 1), 'seen'); return send(res, 200, { ok: true }); }
      if (action === 'flags') {
        const set = url.searchParams.get('set'); if (!['seen', 'unseen', 'flagged', 'unflagged'].includes(set)) return send(res, 400, { error: 'uid and set required' });
        await ews.setFlags(a, ewsIds, set); return send(res, 200, { ok: true });
      }
      if (action === 'move') {
        const dest = url.searchParams.get('dest'); if (!dest) return send(res, 400, { error: 'uid and dest required' });
        if (dest === mailbox) return send(res, 200, { ok: true, moved: 0 });
        await ews.moveTo(a, ewsIds, utf7Decode(dest)); return send(res, 200, { ok: true, moved: ewsIds.length });
      }
      if (action === 'restore') { await ews.moveTo(a, ewsIds, 'INBOX'); return send(res, 200, { ok: true, result: 'moved to inbox' }); }
      if (action === 'delete') {
        const inBin = /^(deleted items|[eé]l[eé]ments supprim[eé]s|trash|corbeille)$/i.test(box);
        await ews.deleteMail(a, ewsIds, inBin); return send(res, 200, { ok: true, result: inBin ? 'deleted' : 'moved to bin' });
      }
      if (action === 'deleteDraft') { await ews.deleteMail(a, ewsIds.slice(0, 1), true); return send(res, 200, { ok: true }); }
      if (action === 'archive') {
        if (/^archives?$/i.test(box)) return send(res, 200, { ok: true, result: 'already archived' });
        let dest = 'Archive';
        try { await ews.folderId(a, dest); } catch {
          const im = new Imap({ host: a.host, port: a.port, user: a.user, pass: a.pass });
          try { await im.connect(); await im.login(); const found = await im.findFolder(/\\Archive/i, /^archives?$/i); if (found) dest = utf7Decode(found); else { const c = await im.command('CREATE "Archive"'); if (!c.ok) throw new Error('could not create Archive: ' + c.status); } } finally { im.logout(); }
        }
        await ews.moveTo(a, ewsIds, dest); return send(res, 200, { ok: true, result: 'archived' });
      }
    }
  } catch (e) { return send(res, 500, { error: String(e && e.message || e) }); }

  const imap = new Imap({ host: a.host, port: a.port, user: a.user, pass: a.pass });
  try {
    await imap.connect();
    await imap.login();
    if (action === 'folders') {
      const folders = await mailFolders(imap);
      if (url.searchParams.get('counts') === '1') { const c = await folderCounts(imap, folders.map((f) => f.name), a); folders.forEach((f) => Object.assign(f, c[f.name] || {})); }
      return send(res, 200, { folders });
    }
    if (action === 'counts') {
      let names = []; try { names = JSON.parse(url.searchParams.get('names') || '[]'); } catch { /* bad list */ }
      return send(res, 200, { counts: await folderCounts(imap, (Array.isArray(names) ? names : []).slice(0, 40), a) });
    }
    if (action === 'move') {
      const uids = uidSet(url.searchParams.get('uid')); const dest = url.searchParams.get('dest');
      if (!uids.length || !dest) return send(res, 400, { error: 'uid and dest required' });
      if (dest === mailbox) return send(res, 200, { ok: true, moved: 0 });
      await imap.moveUid(mailbox, uids.join(','), dest); return send(res, 200, { ok: true, moved: uids.length });
    }
    if (action === 'flags') {
      // set: seen | unseen | flagged | unflagged — on one or several messages.
      const uids = uidSet(url.searchParams.get('uid')); const set = url.searchParams.get('set');
      const map = { seen: '+FLAGS.SILENT (\\Seen)', unseen: '-FLAGS.SILENT (\\Seen)', flagged: '+FLAGS.SILENT (\\Flagged)', unflagged: '-FLAGS.SILENT (\\Flagged)' };
      if (!uids.length || !map[set]) return send(res, 400, { error: 'uid and set required' });
      await imap.selectRW(mailbox); const r = await imap.command(`UID STORE ${uids.join(',')} ${map[set]}`);
      if (!r.ok) throw new Error('update failed: ' + r.status); return send(res, 200, { ok: true });
    }
    if (action === 'createFolder' || action === 'renameFolder') {
      const label = (url.searchParams.get('label') || '').trim();
      if (!label || /[\/\\]/.test(label) || label.length > 100) return send(res, 400, { error: 'Give a folder name (no / or \\).' });
      const all = await imap.listFolders(); const delim = (all[0] && all[0].delim) || '/';
      if (action === 'createFolder') {
        const parent = url.searchParams.get('parent');
        const name = (parent ? parent + delim : '') + utf7Encode(label);
        if (all.some((f) => f.name.toLowerCase() === name.toLowerCase())) return send(res, 409, { error: 'A folder with that name already exists here.' });
        const r = await imap.command(`CREATE ${qbox(name)}`); if (!r.ok) throw new Error('could not create the folder: ' + r.status);
        return send(res, 200, { ok: true, name });
      }
      const from = url.searchParams.get('folder'); const f = all.find((x) => x.name === from);
      if (!f) return send(res, 404, { error: 'folder not found' });
      if (specialOf(f)) return send(res, 400, { error: 'This folder cannot be renamed.' });
      const name = from.split(delim).slice(0, -1).concat(utf7Encode(label)).join(delim);
      const r = await imap.command(`RENAME ${qbox(from)} ${qbox(name)}`); if (!r.ok) throw new Error('could not rename the folder: ' + r.status);
      return send(res, 200, { ok: true, name });
    }
    if (action === 'deleteFolder') {
      // Outlook-style: the folder (with its mail and subfolders) goes to Deleted Items, so it can be recovered.
      const from = url.searchParams.get('folder'); const all = await imap.listFolders(); const f = all.find((x) => x.name === from);
      if (!f) return send(res, 404, { error: 'folder not found' });
      if (specialOf(f)) return send(res, 400, { error: 'This folder cannot be deleted.' });
      const trash = all.find((x) => specialOf(x) === 'trash');
      if (trash && !from.startsWith(trash.name + f.delim)) {
        let name = trash.name + f.delim + from.split(f.delim).pop();
        if (all.some((x) => x.name === name)) name += ' ' + new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');
        const r = await imap.command(`RENAME ${qbox(from)} ${qbox(name)}`); if (!r.ok) throw new Error('could not delete the folder: ' + r.status);
        return send(res, 200, { ok: true, result: 'moved to Deleted Items', name });
      }
      const subs = all.filter((x) => x.name.startsWith(from + f.delim)).sort((x, y) => y.name.length - x.name.length);
      for (const x of subs) await imap.command(`DELETE ${qbox(x.name)}`);
      const r = await imap.command(`DELETE ${qbox(from)}`); if (!r.ok) throw new Error('could not delete the folder: ' + r.status);
      return send(res, 200, { ok: true, result: 'deleted' });
    }
    if (action === 'delete' || action === 'archive') {
      const uids = uidSet(url.searchParams.get('uid')); if (!uids.length) return send(res, 400, { error: 'uid required' });
      const uid = uids.join(',');
      if (action === 'delete') {
        const trash = await imap.findFolder(/\\Trash/i, /deleted items|trash|supprim/i);
        // Already in the bin (or no bin): delete for good. Otherwise move to the bin (recoverable).
        if (!trash || trash === mailbox) { await imap.expungeUid(mailbox, uid); return send(res, 200, { ok: true, result: 'deleted' }); }
        await imap.moveUid(mailbox, uid, trash); return send(res, 200, { ok: true, result: 'moved to bin' });
      }
      let arch = await imap.findFolder(/\\Archive/i, /^archives?$/i);
      if (!arch) { const c = await imap.command('CREATE "Archive"'); if (!c.ok) throw new Error('could not create Archive: ' + c.status); arch = 'Archive'; }
      if (arch === mailbox) return send(res, 200, { ok: true, result: 'already archived' });
      await imap.moveUid(mailbox, uid, arch); return send(res, 200, { ok: true, result: 'archived' });
    }
    if (action === 'restore') {
      const uid = uidSet(url.searchParams.get('uid')).join(','); if (!uid) return send(res, 400, { error: 'uid required' });
      await imap.moveUid(mailbox, uid, 'INBOX'); return send(res, 200, { ok: true, result: 'moved to inbox' });
    }
    if (action === 'search') {
      const q = (url.searchParams.get('q') || '').trim(); if (q.length < 2) return send(res, 400, { error: 'type at least 2 characters' });
      return send(res, 200, await searchMessages(imap, mailbox, q.slice(0, 120), 60, url.searchParams.get('body') === '1'));
    }
    if (action === 'contacts') {
      const hit = contactCache.get(a.id);
      if (hit && Date.now() - hit.at < 10 * 60 * 1000) return send(res, 200, { contacts: hit.data, cached: true });
      const data = await collectContacts(imap, a.email); contactCache.set(a.id, { at: Date.now(), data });
      return send(res, 200, { contacts: data });
    }
    if (action === 'saveDraft') { return send(res, 200, await saveDraft(imap, a, await readBody(req))); }
    if (action === 'deleteDraft') {
      const uid = Number(url.searchParams.get('uid')); const df = await draftsFolder(imap);
      if (uid && df) await imap.expungeUid(df, uid);
      return send(res, 200, { ok: true });
    }
    if (action === 'markread') { const uid = Number(url.searchParams.get('uid')); if (!uid) return send(res, 400, { error: 'uid required' }); await imap.markSeen(mailbox, uid); return send(res, 200, { ok: true }); }
    if (action === 'list') { const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit') || 30))); return send(res, 200, await listMessages(imap, mailbox, limit, Math.max(0, Number(url.searchParams.get('skip') || 0)), url.searchParams.get('filter') || '')); }
    if (action === 'message') { const uid = Number(url.searchParams.get('uid')); if (!uid) return send(res, 400, { error: 'uid required' }); const raw = await fetchRaw(imap, mailbox, uid); if (!raw) return send(res, 404, { error: 'message not found' }); return send(res, 200, assembleMessage(raw)); }
    if (action === 'attachment') {
      const uid = Number(url.searchParams.get('uid')); const idx = Number(url.searchParams.get('idx'));
      if (!uid) return send(res, 400, { error: 'uid required' });
      const raw = await fetchRaw(imap, mailbox, uid); if (!raw) return send(res, 404, { error: 'message not found' });
      const atts = []; const walk = (p) => { if (p.multipart) p.parts.forEach(walk); else if (p.isAttach && p.filename) atts.push(p); }; walk(parsePart(raw));
      const at = atts[idx]; if (!at) return send(res, 404, { error: 'attachment not found' });
      res.writeHead(200, { 'Content-Type': at.contentType || 'application/octet-stream', 'Content-Disposition': `attachment; filename="${(at.filename || 'file').replace(/"/g, '')}"` });
      return res.end(at.bytes);
    }
    return send(res, 400, { error: 'unknown action' });
  } catch (e) { return send(res, 500, { error: String(e) }); }
  finally { imap.logout(); }
});
server.listen(PORT, () => console.log(`mail-imap sidecar on :${PORT} (host ${DEFAULT_HOST}:${DEFAULT_PORT})`));

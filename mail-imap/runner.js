'use strict';
// PB Abbey · scan-runner — server-side receipt scanning so nobody has to keep a
// browser tab open. Two loops:
//   1. Job queue (public.scan_jobs): pick the oldest queued job, run it through
//      the Cloudflare scanner, write the receipts, email the person who sent it.
//   2. accounts@ inbox: every few minutes, turn new PDF/photo attachments into
//      jobs in the "Emailed documents" folder (every line forced to "To check",
//      because that mailbox also gets remittances/contracts, not just invoices).
// Talks to Supabase through the internal gateway with the service role.
const nodemailer = require('nodemailer');
const https = require('https');

const API = process.env.SUPABASE_URL || 'http://api-gw:8000';
const KEY = process.env.SERVICE_ROLE_KEY;
const PUBLIC_API = process.env.PUBLIC_API || 'https://api.pbabbey.com';
const APP = process.env.APP_URL || 'https://pbabbey.com';
const WORKER = process.env.WORKER_URL || 'https://pb-abbey-mistral.leo-bncf.workers.dev';
const SIDECAR = process.env.MAIL_SIDECAR || 'http://mail-imap:8799';
const INGEST_ACCOUNT = process.env.INGEST_ACCOUNT || 'accounts';
const INGEST_FOLDER = process.env.INGEST_FOLDER || 'Emailed documents';
const NOTIFY_FALLBACK = process.env.NOTIFY_FALLBACK || 'office@pbabbey.com';
const MAIL_EVERY_MS = Number(process.env.MAIL_EVERY_MS || 5 * 60 * 1000);
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/127 Safari/537.36 pbabbey-scan-runner';
const H = { apikey: KEY, Authorization: `Bearer ${KEY}` };
const log = (...a) => console.log(new Date().toISOString(), ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

async function rest(method, path, body, extra = {}) {
  const res = await fetch(`${API}/rest/v1/${path}`, {
    method, headers: { ...H, 'Content-Type': 'application/json', Prefer: 'return=representation', ...extra },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const txt = await res.text();
  if (!res.ok) throw new Error(`${method} ${path.split('?')[0]} ${res.status}: ${txt.slice(0, 200)}`);
  return txt ? JSON.parse(txt) : null;
}

// Same rule as the app: "…_PB Abbey_August-September 2026.pdf" -> "August-September 2026".
const periodFromName = (n) => ((n || '').match(/([A-Za-z]+(?:-[A-Za-z]+)?\s+\d{4})\s*(?:\[[^\]]*\])?\.?[a-z0-9]*$/i) || [])[1]?.trim() || '';
const baseName = (fn) => (fn || '').replace(/\s*\[\d+\/\d+\]\s*$/, '').trim();

// Mirror of Upload.jsx processReceipt: VAT maths, review flags, naming, notes.
function buildRows(job, extracted) {
  const n = extracted.length;
  return extracted.map((r, i) => {
    const cur = r.currency || 'GBP';
    const total = Number(r.total_amount) || 0;
    let va = r.vat_amount, vr = r.vat_rate;
    const carnas = job.workspace === 'carnas';
    if (cur === 'EUR' && !carnas) { va = 0; vr = 0; } // PB Abbey: foreign VAT is not reclaimable on a UK return
    else if (!r.vat_explicit && !r.is_tax_free && total && r.vat_rate) va = r2(total - total / (1 + r.vat_rate / 100));
    const issues = [];
    if ((r.confidence_score || 0) < 70) issues.push('low confidence');
    if (!r.vendor_name) issues.push('missing vendor');
    if (!r.total_amount) issues.push('missing total');
    if (!r.receipt_date) issues.push('missing date');
    if (total < 0) issues.push('negative total');
    if ((va || 0) < 0) issues.push('negative VAT');
    if (total > 0 && (va || 0) > total) issues.push('VAT exceeds total');
    if (total > 0 && (va || 0) > total * 0.25) issues.push('VAT over 25% of total');
    if (r.verification && r.verification !== 'OK') issues.push(`second reader: ${r.verification}`);
    if (job.force_review) issues.push('arrived by email — confirm it is a PB Abbey expense');
    if (carnas && cur !== 'EUR') issues.push(`currency ${cur} — Carnas expenses are normally in euros`);
    let notes = r.extraction_notes || '';
    if (r.receipt_location) notes += ` [Location: ${r.receipt_location}]`;
    if (n > 1) notes += ` [Part ${i + 1} of ${n} receipts from same image]`;
    if (issues.length) notes += ` [Review needed: ${issues.join(', ')}]`;
    return {
      file_url: job.file_url, file_name: job.file_name + (n > 1 ? ` [${i + 1}/${n}]` : ''), file_type: job.file_type || 'pdf',
      folder_id: job.folder_id || null, status: 'extracted', ocr_text: r.ocr_text || '',
      vendor_name: r.vendor_name || '', receipt_date: r.receipt_date || null, country: r.country || '', currency: cur,
      total_amount: total, vat_amount: va || 0, vat_rate: vr || 0, vat_explicit: !!r.vat_explicit, is_tax_free: !!r.is_tax_free,
      confidence_score: r.confidence_score || 50, needs_review: issues.length > 0, is_reviewed: false,
      upload_batch: `job_${job.id}`, extraction_notes: notes.trim(), workspace: job.workspace || 'pbabbey',
      page_number: r.page_number ?? null, box_2d: r.box_2d ?? null, verification: r.verification ?? null,
      verifier_amount: r.verifier_amount ?? null, verifier_date: r.verifier_date ?? null, vat_inferred: !!r.vat_inferred,
    };
  });
}

// ---- email ----
const transport = nodemailer.createTransport({
  host: process.env.IONOS_SMTP_HOST || 'smtp.exchange.ionos.eu', port: Number(process.env.IONOS_SMTP_PORT || 587),
  secure: false, requireTLS: true, auth: { user: process.env.MAIL_OFFICE_USER, pass: process.env.MAIL_OFFICE_PASS },
});
async function notify(to, subject, lines) {
  if (!to || !process.env.MAIL_OFFICE_USER) return;
  const text = lines.join('\n');
  const body = lines.map((l) => `<p style="margin:0 0 10px">${l.replace(/(https:\/\/\S+)/g, '<a href="$1" style="display:inline-block;background:#171717;color:#fff;text-decoration:none;padding:8px 14px;border-radius:4px;font-size:13px">Open PB Abbey</a>')}</p>`).join('');
  const html = `<div style="background:#f5f4f1;padding:24px 0"><div style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #e5e5e5;font-family:-apple-system,Segoe UI,Arial,sans-serif;font-size:14px;line-height:1.5;color:#171717">`
    + `<div style="padding:14px 22px;border-bottom:1px solid #e5e5e5;font-weight:600;letter-spacing:-0.01em">PB Abbey</div>`
    + `<div style="padding:20px 22px">${body}</div>`
    + `<div style="padding:12px 22px;border-top:1px solid #e5e5e5;font-size:11px;color:#737373">PB Abbey Ltd · Registered in England and Wales, company no. 08819146 · Registered office: One New Street, Wells, Somerset BA5 2LA</div></div></div>`;
  try { await transport.sendMail({ from: `"PB Abbey" <${process.env.MAIL_OFFICE_USER}>`, to, subject, text, html }); }
  catch (e) { log('notify failed:', e.message); }
}

// ---- job loop ----
async function claimNext() {
  const q = await rest('GET', 'scan_jobs?status=eq.queued&order=created_date.asc&limit=1');
  if (!q.length) return null;
  // Atomic claim: only succeeds if still queued.
  const got = await rest('PATCH', `scan_jobs?id=eq.${q[0].id}&status=eq.queued`, { status: 'running', started_at: new Date().toISOString(), updated_date: new Date().toISOString() });
  return got[0] || null;
}

// One public.api_usage row per model used by this scan (read by the Billing page).
async function logUsage(job, usage) {
  const rows = Object.entries(usage || {}).map(([model, u]) => ({
    job_id: job.id, file_name: job.file_name, model,
    provider: /^gemini/i.test(model) ? 'gemini' : /mistral/i.test(model) ? 'mistral' : 'other',
    calls: u.calls || 0, input_tokens: u.input || 0, output_tokens: u.output || 0, pages: u.pages || 0, workspace: job.workspace || 'pbabbey',
  }));
  if (rows.length) await rest('POST', 'api_usage', rows, { Prefer: 'return=minimal' }).catch((e) => log('usage log failed', e.message));
}

// POST to the scanner with plain https: Node's fetch gives up after 5 minutes
// without a reply (undici headersTimeout), and a long PDF can take longer when
// Gemini is slow. Our own limit is 25 minutes.
function postWorker(body) {
  return new Promise((resolve, reject) => {
    const data = Buffer.from(JSON.stringify(body));
    const req = https.request(WORKER, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': data.length, 'User-Agent': UA } }, (res) => {
      const chunks = []; res.on('data', (c) => chunks.push(c));
      res.on('end', () => { let json = {}; try { json = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { /* not JSON */ } resolve({ ok: res.statusCode < 400, status: res.statusCode, json }); });
      res.on('error', reject);
    });
    req.setTimeout(25 * 60 * 1000, () => req.destroy(new Error('the scanner took more than 25 minutes')));
    req.on('error', reject);
    req.end(data);
  });
}

async function runJob(job) {
  log('job start', job.id, job.file_name);
  const res = await postWorker({ file_url: job.file_url, period: job.period || periodFromName(job.file_name), region: job.workspace === 'carnas' ? 'FR' : 'UK' });
  const payload = res.json;
  await logUsage(job, payload.usage); // billed even if the result turns out empty
  if (!res.ok || payload.error || !Array.isArray(payload.receipts)) throw Object.assign(new Error(payload.error || `scanner HTTP ${res.status}`), { transient: res.status >= 500 || res.status === 429 });
  if (payload.receipts.length === 0) throw new Error('the scanner found no receipts in this document');
  const rows = buildRows(job, payload.receipts);

  // Rescan: remember the old rows, insert the new ones, then delete the old ones
  // (never a moment with no data for that document).
  let oldIds = [];
  if (job.replace_doc) {
    const all = await rest('GET', `receipts?select=id,file_name&workspace=eq.${job.workspace || 'pbabbey'}&file_name=like.${encodeURIComponent(job.replace_doc)}*`);
    oldIds = all.filter((r) => baseName(r.file_name) === job.replace_doc).map((r) => r.id);
  }
  await rest('POST', 'receipts', rows, { Prefer: 'return=minimal' });
  if (oldIds.length) await rest('DELETE', `receipts?id=in.(${oldIds.join(',')})`, undefined, { Prefer: 'return=minimal' });

  const toCheck = rows.filter((r) => r.needs_review).length;
  await rest('PATCH', `scan_jobs?id=eq.${job.id}`, { status: 'done', receipts_count: rows.length, to_check_count: toCheck, finished_at: new Date().toISOString(), updated_date: new Date().toISOString(), error: payload.engine === 'mistral' ? `fallback engine used: ${payload.fallback_reason || ''}`.slice(0, 300) : null });
  log('job done', job.id, rows.length, 'receipts,', toCheck, 'to check', oldIds.length ? `(replaced ${oldIds.length})` : '');
  const book = job.workspace === 'carnas' ? { name: 'Carnas', base: `${APP}/carnas` } : { name: 'PB Abbey', base: APP };
  await notify(job.notify_email || NOTIFY_FALLBACK, `${book.name}: ${job.file_name} — ${plural(rows.length, 'receipt')}${toCheck ? `, ${toCheck} to check` : ''}`, [
    `The scan of <b>${job.file_name}</b> has finished.`,
    `${plural(rows.length, 'receipt')} found${oldIds.length ? ` (replacing ${oldIds.length})` : ''}. ${toCheck ? `${toCheck === 1 ? 'One needs' : `${toCheck} need`} a quick check with the photo of the ticket:` : 'All confirmed by both readers — nothing to check.'}`,
    toCheck ? `${book.base}/Review` : `${book.base}/Dashboard`,
  ]);
}

async function jobLoop() {
  // Jobs left "running" by a restart go back to the queue.
  try { await rest('PATCH', `scan_jobs?status=eq.running&started_at=lt.${new Date(Date.now() - 30 * 60 * 1000).toISOString()}`, { status: 'queued' }); } catch (e) { log('reset failed', e.message); }
  for (;;) {
    let job = null;
    try {
      job = await claimNext();
      if (job) await runJob(job);
      else await sleep(8000);
    } catch (e) {
      log('job error', job?.id, e.message);
      // Connection problems / scanner overloaded: put it back in the queue (twice) before giving up.
      const transient = e.transient || /fetch failed|ECONNRESET|ETIMEDOUT|EAI_AGAIN|socket hang up|25 minutes/i.test(String(e.message));
      if (job && transient && (job.attempts || 0) < 2) {
        await rest('PATCH', `scan_jobs?id=eq.${job.id}`, { status: 'queued', attempts: (job.attempts || 0) + 1, error: `retrying after: ${String(e.message).slice(0, 200)}`, updated_date: new Date().toISOString() }).catch(() => {});
        log('job requeued', job.id, (job.attempts || 0) + 1);
        await sleep(60000);
        continue;
      }
      if (job && transient) e.message = `could not reach the scanner after 3 tries (${e.message})`;
      if (job) {
        await rest('PATCH', `scan_jobs?id=eq.${job.id}`, { status: 'error', error: String(e.message).slice(0, 500), finished_at: new Date().toISOString(), updated_date: new Date().toISOString() }).catch(() => {});
        const base = job.workspace === 'carnas' ? `${APP}/carnas` : APP;
        await notify(job.notify_email || NOTIFY_FALLBACK, `${job.workspace === 'carnas' ? 'Carnas' : 'PB Abbey'}: scan failed — ${job.file_name}`, [
          `The scan of <b>${job.file_name}</b> did not work: ${String(e.message).slice(0, 300)}`,
          `Your file is safe. Open ${base}/Upload and press Try again on it.`]);
      }
      await sleep(5000);
    }
  }
}

// ---- accounts@ ingestion ----
async function folderId() {
  const f = await rest('GET', `folders?select=id&name=eq.${encodeURIComponent(INGEST_FOLDER)}&limit=1`);
  if (f.length) return f[0].id;
  return (await rest('POST', 'folders', { name: INGEST_FOLDER }))[0].id;
}
const sidecar = async (q) => { const r = await fetch(`${SIDECAR}/?${new URLSearchParams(q)}`); if (!r.ok) throw new Error(`mail ${q.action} ${r.status}`); return r; };

async function ingestOnce() {
  const seen = await rest('GET', `mail_ingest?select=uid,status&account=eq.${INGEST_ACCOUNT}`);
  const list = await (await sidecar({ action: 'list', account: INGEST_ACCOUNT, limit: 40 })).json();
  const msgs = list.messages || [];
  if (!seen.length) {
    // First run: start from now — record the newest message as a baseline, don't backfill.
    const top = Math.max(0, ...msgs.map((m) => m.uid));
    await rest('POST', 'mail_ingest', { account: INGEST_ACCOUNT, uid: top, status: 'baseline', detail: `ingestion starts after uid ${top}` });
    log('ingest baseline set at uid', top); return;
  }
  const baseline = Math.max(...seen.filter((s) => s.status === 'baseline').map((s) => s.uid), 0);
  const known = new Set(seen.map((s) => s.uid));
  const fresh = msgs.filter((m) => m.uid > baseline && !known.has(m.uid)).sort((a, b) => a.uid - b.uid);
  for (const m of fresh) {
    const rec = { account: INGEST_ACCOUNT, uid: m.uid, subject: (m.subject || '').slice(0, 300), sender: (m.from || '').slice(0, 200) };
    try {
      const full = await (await sidecar({ action: 'message', account: INGEST_ACCOUNT, uid: m.uid })).json();
      const atts = (full.attachments || []).map((a, idx) => ({ ...a, idx }))
        .filter((a) => /pdf|jpe?g|png/i.test(a.contentType || a.filename || '') && a.size >= 30000); // skip logos/signatures
      if (!atts.length) { await rest('POST', 'mail_ingest', { ...rec, status: 'skipped', detail: 'no PDF/photo attachment' }); continue; }
      const fid = await folderId();
      const sender = ((m.from || '').match(/^\s*"?([^"<]+?)"?\s*</) || [])[1] || (m.from || 'unknown');
      for (const a of atts) {
        const bytes = Buffer.from(await (await sidecar({ action: 'attachment', account: INGEST_ACCOUNT, uid: m.uid, idx: a.idx })).arrayBuffer());
        const ext = (a.filename.match(/\.(pdf|jpe?g|png)$/i) || ['.pdf'])[0].toLowerCase();
        const path = `email_${m.uid}_${a.idx}_${Date.now()}${ext}`;
        const up = await fetch(`${API}/storage/v1/object/receipts/${path}`, { method: 'POST', headers: { ...H, 'Content-Type': a.contentType || 'application/octet-stream' }, body: bytes });
        if (!up.ok) throw new Error(`storage ${up.status}`);
        const day = (m.date ? new Date(m.date) : new Date()).toISOString().slice(0, 10);
        await rest('POST', 'scan_jobs', {
          file_url: `${PUBLIC_API}/storage/v1/object/public/receipts/${path}`,
          file_name: `Email ${day} - ${sender.trim().slice(0, 40)} - ${a.filename}`.replace(/[\/\\]/g, '-'),
          file_type: ext.replace('.', '').replace('jpeg', 'jpg'), folder_id: fid, source: 'email', force_review: true,
          notify_email: NOTIFY_FALLBACK, created_by: `${INGEST_ACCOUNT}@ inbox`,
        });
      }
      await rest('POST', 'mail_ingest', { ...rec, status: 'queued', detail: `${atts.length} attachment(s) queued` });
      log('ingest queued uid', m.uid, atts.length, 'attachment(s)');
    } catch (e) {
      log('ingest error uid', m.uid, e.message);
      await rest('POST', 'mail_ingest', { ...rec, status: 'error', detail: String(e.message).slice(0, 300) }).catch(() => {});
    }
  }
}

// Switched OFF on 14 Oct 2026 (Leo): accounts@ attachments are no longer turned
// into receipts. Set MAIL_INGEST=on in the scan-runner environment to bring it
// back — note it would then pick up the recent attachments received meanwhile.
const MAIL_INGEST = (process.env.MAIL_INGEST || 'off').toLowerCase() === 'on';
async function ingestLoop() {
  if (!MAIL_INGEST) return log('accounts@ ingestion: off');
  for (;;) {
    try { await ingestOnce(); } catch (e) { log('ingest loop error', e.message); }
    await sleep(MAIL_EVERY_MS);
  }
}

// ---- legal deadline reminders (same rules as src/lib/company.js) ----
// Emails 30, 14, 7 and 1 days before, and once when late. Done / reminded state in
// app_settings 'company_filings' { filed: {key:{at,by}}, reminded: {key:[days...]} }.
const DEADLINE_EMAILS = process.env.DEADLINE_EMAILS || 'office@pbabbey.com,chrispetban@gmail.com';
const DL = {
  cs: { label: 'Confirmation statement', who: 'Companies House', first: '2026-12-18', due: (p) => addDays(p, 14), period: (p) => `review date ${fmtD(p)}` },
  accounts: { label: 'Annual accounts', who: 'Companies House', first: '2026-06-29', due: (p) => addMonths(p, 9), period: (p) => `year to ${fmtD(p)}` },
  ct_pay: { label: 'Corporation Tax payment', who: 'HMRC', first: '2026-06-29', due: (p) => addDays(addMonths(p, 9), 1), period: (p) => `year to ${fmtD(p)}` },
  ct600: { label: 'Corporation Tax return (CT600)', who: 'HMRC', first: '2026-06-29', due: (p) => addMonths(p, 12), period: (p) => `year to ${fmtD(p)}` },
};
const isoD = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const atD = (s) => new Date(`${s}T12:00:00`);
function addMonths(s, m) { const d = atD(s); const day = d.getDate(); d.setDate(1); d.setMonth(d.getMonth() + m); d.setDate(Math.min(day, new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate())); return isoD(d); }
function addDays(s, n) { const d = atD(s); d.setDate(d.getDate() + n); return isoD(d); }
const fmtD = (s) => atD(s).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
const STEPS = [30, 14, 7, 1];

async function deadlinesOnce() {
  const row = (await rest('GET', 'app_settings?id=eq.company_filings&select=value'))[0];
  const value = row?.value || {};
  const filed = value.filed || {}, reminded = value.reminded || {};
  const today = isoD(new Date());
  let changed = false;
  for (const [kind, k] of Object.entries(DL)) {
    let p = k.first;
    for (let i = 0; i < 50 && filed[`${kind}:${p}`]; i++) p = addMonths(p, 12);
    const key = `${kind}:${p}`, due = k.due(p);
    const left = Math.round((atD(due) - atD(today)) / 86400000);
    const sent = reminded[key] || [];
    // The step we're at: the smallest threshold >= days left (or -1 = late).
    const step = left < 0 ? -1 : STEPS.filter((x) => left <= x).pop();
    if (step === undefined || sent.includes(step)) continue;
    const when = left < 0 ? `was due on ${fmtD(due)} — ${-left} day${left === -1 ? '' : 's'} late` : `is due on <b>${fmtD(due)}</b> — in ${left} day${left === 1 ? '' : 's'}`;
    await notify(DEADLINE_EMAILS, `PB Abbey: ${k.label} ${left < 0 ? 'is late' : `due in ${left} day${left === 1 ? '' : 's'}`}`, [
      `The <b>${k.label}</b> (${k.who}, ${k.period(p)}) ${when}.`,
      'Once it is filed or paid, press "Mark as done" on the Company page so the reminders stop.',
      `${APP}/company`,
    ]);
    reminded[key] = [...sent, step]; changed = true;
    log('deadline reminder', key, left);
  }
  if (changed) await rest('POST', 'app_settings?on_conflict=id', { id: 'company_filings', value: { ...value, reminded }, updated_by: 'scan-runner', updated_date: new Date().toISOString() }, { Prefer: 'resolution=merge-duplicates,return=minimal' });
}
async function deadlineLoop() {
  for (;;) { try { await deadlinesOnce(); } catch (e) { log('deadline loop error', e.message); } await sleep(6 * 60 * 60 * 1000); }
}

// ---- Outlook: put the legal + VAT deadlines in the office@ calendar ----
// Switched on/off on the Company page (app_settings 'outlook_sync'.enabled).
// Only ever touches events it created itself (ids kept in 'outlook_sync'.items).
const VAT_ENDS = { 1: [3, 6, 9, 12], 2: [4, 7, 10, 1], 3: [5, 8, 11, 2] };
async function sidecarPost(q, body) {
  const r = await fetch(`${SIDECAR}/?${new URLSearchParams(q)}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`calendar ${q.action}: ${j.error || r.status}`);
  return j;
}
async function wantedDeadlines() {
  const row = (await rest('GET', 'app_settings?id=eq.company_filings&select=value'))[0];
  const filed = row?.value?.filed || {};
  const today = isoD(new Date());
  const out = {};
  for (const [kind, k] of Object.entries(DL)) {
    let p = k.first;
    for (let i = 0; i < 50 && filed[`${kind}:${p}`]; i++) p = addMonths(p, 12);
    out[`${kind}:${p}`] = { date: k.due(p), subject: `PB Abbey: ${k.label} due (${k.who})`, body: `${k.label} — ${k.period(p)}.\nMark it as done on ${APP}/company once filed or paid.` };
  }
  const vs = (await rest('GET', 'app_settings?id=eq.vat_settings&select=value'))[0];
  const ends = VAT_ENDS[vs?.value?.stagger] || VAT_ENDS[1];
  const filedQ = new Set((await rest('GET', 'vat_quarters?select=quarter_id,status&status=eq.submitted')).map((q) => q.quarter_id));
  const horizon = addMonths(today, 7);
  for (let y = Number(today.slice(0, 4)) - 1; y <= Number(today.slice(0, 4)) + 1; y++) {
    for (const m of ends) {
      const end = isoD(new Date(y, m, 0, 12)), deadline = isoD(new Date(y, m + 1, 7, 12));
      if (deadline < today || deadline > horizon || filedQ.has(end)) continue;
      out[`vat:${end}`] = { date: deadline, subject: 'PB Abbey: VAT return due (HMRC)', body: `VAT return for the quarter ending ${fmtD(end)}.\n${APP}/VATReturn` };
    }
  }
  return out;
}
async function outlookOnce() {
  const row = (await rest('GET', 'app_settings?id=eq.outlook_sync&select=value'))[0];
  const value = row?.value || {};
  const items = { ...(value.items || {}) };
  const account = value.account || 'office';
  const want = value.enabled ? await wantedDeadlines() : {};
  let changed = false;
  for (const [key, it] of Object.entries(items)) {   // gone (done / switched off) or moved: remove
    if (!want[key] || want[key].date !== it.date) {
      try { await sidecar({ action: 'calendarDelete', account: it.account || account, id: it.id }); } catch (e) { log('outlook delete failed', key, e.message); continue; }
      delete items[key]; changed = true; log('outlook removed', key);
    }
  }
  for (const [key, w] of Object.entries(want)) {     // missing: create (all day, reminder 2 weeks before)
    if (items[key]) continue;
    const ev = await sidecarPost({ action: 'calendarCreate', account }, { subject: w.subject, body: w.body, date: w.date, reminderMinutes: 14 * 24 * 60 });
    items[key] = { id: ev.id, date: w.date, account }; changed = true; log('outlook added', key, w.date);
  }
  if (changed) await rest('POST', 'app_settings?on_conflict=id', { id: 'outlook_sync', value: { ...value, items, synced: new Date().toISOString() }, updated_by: 'scan-runner', updated_date: new Date().toISOString() }, { Prefer: 'resolution=merge-duplicates,return=minimal' });
}
async function outlookLoop() {
  for (;;) { try { await outlookOnce(); } catch (e) { log('outlook loop error', e.message); } await sleep(10 * 60 * 1000); }
}

// ---- rent: create this month's lines (if switched on in Tenant → Rent) ----
// generate_rent() is idempotent (skips units already billed for the month).
async function rentOnce() {
  const row = (await rest('GET', 'app_settings?id=eq.rent_auto&select=value'))[0];
  if (!row?.value?.enabled) return;
  const m = isoD(new Date()).slice(0, 8) + '01';
  const n = await rest('POST', 'rpc/generate_rent', { p_month: m });
  if (n) log('rent generated', m, n);
}
async function rentLoop() {
  for (;;) { try { await rentOnce(); } catch (e) { log('rent loop error', e.message); } await sleep(6 * 60 * 60 * 1000); }
}

if (!KEY) { console.error('SERVICE_ROLE_KEY missing'); process.exit(1); }
log('scan-runner started', { API, WORKER, INGEST_ACCOUNT, INGEST_FOLDER });
jobLoop();
ingestLoop();
deadlineLoop();
outlookLoop();
require('./bank')({ rest, log, sleep }); // bank accounts (read-only) + matching payments to rent
require('./weekly')({ rest, log, sleep, transport }); // Monday internal summary to Peter + Leo (off until switched on)
require('./mailassist')({ rest, log, sleep }); // sorts office@ mail + drafts replies on the home GPU; never sends
rentLoop();

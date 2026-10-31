'use strict';
// PB Abbey · mail assistant — every 5 minutes, reads the new mail in office@'s inbox
// (without marking it read), works out which tenant it is from, sorts it (repair,
// rent, lease, letting enquiry, supplier, …) and, when it needs an answer, writes a
// draft reply. Models run on the home GPU (ai-gpu, Ollama behind its key gateway);
// nothing leaves the house's own servers. Nothing is ever sent: the draft waits in
// Actions, Peter opens it in Mail, changes what he wants and sends it himself.
const fs = require('fs');

const SIDECAR = process.env.MAIL_SIDECAR || 'http://mail-imap:8799';
const AI = process.env.AI_GATEWAY_URL || 'http://192.168.2.21:11434';
const KEY_PATH = process.env.AI_KEY_PATH || '/app/secrets/ai-gateway.key';
const FAST = 'qwen3:4b-instruct-2507-q4_K_M';
const MAIN = 'qwen3:30b-a3b-instruct-2507-q4_K_M';
const ACCOUNT = 'office';
const CATS = ['repair_request', 'rent_payment', 'lease', 'letting_enquiry', 'service_charge', 'supplier_invoice', 'accountant_or_tax', 'bank', 'legal', 'insurance', 'personal', 'newsletter_or_automated', 'other'];
const ROBOT = /no-?reply|mailer-daemon|postmaster|notifications?@|newsletter|marketing|mailchimp|hubspot|bounce/i;

module.exports = function startMailAssist({ rest, log, sleep }) {
  const key = () => { try { return fs.readFileSync(KEY_PATH, 'utf8').trim(); } catch { return ''; } };
  async function chat(model, messages, json) {
    const r = await fetch(`${AI}/api/chat`, { method: 'POST', headers: { Authorization: `Bearer ${key()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, messages, stream: false, ...(json ? { format: 'json' } : {}), options: { temperature: 0.2 } }), signal: AbortSignal.timeout(180000) });
    if (!r.ok) throw new Error(`AI ${r.status}`);
    return (await r.json()).message?.content || '';
  }
  const side = async (q) => { const r = await fetch(`${SIDECAR}/?${new URLSearchParams(q)}`); if (!r.ok) throw new Error(`mail ${q.action} ${r.status}`); return r.json(); };
  const emailOf = (s) => ((String(s || '').match(/<([^>]+)>/) || [])[1] || String(s || '').trim()).toLowerCase();
  const nameOf = (s) => String(s || '').replace(/<[^>]*>/, '').replace(/"/g, '').trim();
  const strip = (html) => String(html || '').replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>/gi, '\n').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n\n').trim();
  // The new part of the mail, without the quoted thread below it (unless that would leave almost nothing).
  const bodyOnly = (t) => { const s = String(t || '').replace(/[ \t]+\n/g, '\n'); const cut = s.search(/\n\s*(From:|De :|-----Original|On .{5,80} wrote:|Le .{5,80} a écrit|Sent from my)/i); return (cut > 200 ? s.slice(0, cut) : s).slice(0, 4000); };

  // Who is it from? Tenant's saved email, then contacts found earlier, then the same email domain.
  async function findTenant(email) {
    if (!email) return null;
    const ts = await rest('GET', 'tenants?status=neq.ended&select=id,name,email,notes');
    let t = ts.find((x) => (x.email || '').toLowerCase() === email || (x.notes || '').toLowerCase().includes(email));
    if (!t) { const s = await rest('GET', `contact_suggestions?email=eq.${encodeURIComponent(email)}&status=neq.rejected&select=tenant_id`); if (s[0]) t = ts.find((x) => x.id === s[0].tenant_id); }
    const dom = email.split('@')[1] || '';
    if (!t && dom && !/gmail|hotmail|outlook|yahoo|icloud|aol|btinternet|live\.|me\.com/i.test(dom)) t = ts.find((x) => (x.email || '').toLowerCase().endsWith(`@${dom}`));
    return t || null;
  }
  async function tenantFacts(t) {
    if (!t) return '';
    const units = await rest('GET', `units?tenant_id=eq.${t.id}&select=reference,site,rent_amount,lease_end,break_date,next_review,sc_included`);
    const owed = await rest('GET', `rent_payments?tenant_id=eq.${t.id}&outstanding=gt.0&status=neq.paid&select=due_date,outstanding,notes&order=due_date`);
    const today = new Date().toISOString().slice(0, 10);
    const late = owed.filter((p) => p.due_date < today);
    return [`Tenant: ${t.name}.`,
      ...units.map((u) => `Unit ${u.reference} (${u.site}): rent £${Math.round(u.rent_amount * 12)} a year excl. VAT${u.lease_end ? `, lease ends ${u.lease_end}` : ''}${u.break_date ? `, tenant break ${u.break_date}` : ''}.`),
      late.length ? `Unpaid in our records: ${late.map((p) => `£${p.outstanding} due ${p.due_date}`).join('; ')} (payments after 30 Sept 2026 may not be recorded yet).` : 'No unpaid rent in our records.'].join('\n');
  }

  async function handle(m) {
    const full = await side({ action: 'message', account: ACCOUNT, mailbox: 'INBOX', uid: m.uid });
    const fromEmail = emailOf(full.from || m.from); const fromName = nameOf(full.from || m.from);
    const text = bodyOnly(full.text || strip(full.html));
    const row = { id: m.uid, account: ACCOUNT, received_at: m.date || full.date || null, from_name: fromName, from_email: fromEmail, subject: full.subject || m.subject, status: 'new' };
    if (/pbabbey\.com$/i.test(fromEmail)) return rest('POST', 'mail_triage?on_conflict=id', { ...row, category: 'internal', status: 'ignored' }, { Prefer: 'resolution=ignore-duplicates,return=minimal' });
    const t = await findTenant(fromEmail);
    let c = { category: 'other', urgency: 'normal', summary: '', needs_reply: false };
    if (ROBOT.test(fromEmail)) c = { category: 'newsletter_or_automated', urgency: 'low', summary: row.subject, needs_reply: false };
    else {
      const out = await chat(FAST, [
        { role: 'system', content: `You sort the emails of PB Abbey Ltd, a small UK commercial landlord (offices and industrial units in Devon and Halesowen). Reply with JSON only: {"category": one of ${JSON.stringify(CATS)}, "urgency": "high"|"normal"|"low", "summary": one short sentence in plain English saying what the sender wants, "needs_reply": true|false}. "high" only for leaks, safety, break-ins, no power/heating, legal deadlines. needs_reply is false for receipts, newsletters, automatic messages and pure information.` },
        { role: 'user', content: `From: ${fromName} <${fromEmail}>${t ? ` (our tenant ${t.name})` : ''}\nSubject: ${row.subject}\n\n${text.slice(0, 2500)}` }], true);
      try { c = { ...c, ...JSON.parse(out) }; } catch { /* keep defaults */ }
      if (!CATS.includes(c.category)) c.category = 'other';
    }
    let draft = null;
    if (c.needs_reply && !['newsletter_or_automated', 'personal'].includes(c.category)) {
      const facts = await tenantFacts(t);
      draft = (await chat(MAIN, [
        { role: 'system', content: 'You are Peter Bancroft, director of PB Abbey Ltd, a small UK commercial landlord. Write a reply to the email below. Start with a greeting using the sender\'s first name, answer what they ask in 2 to 5 sentences, then sign off "Kind regards,\nPeter Bancroft\nPB Abbey Ltd". British English, warm and businesslike. Use only facts present in the email or in "What we know". Never invent dates, deadlines, amounts, prices, visit times, contractors or commitments, and never promise when you will reply. When a decision or a check is needed, say you will look into it and come back to them. Output the reply text only.' },
        { role: 'user', content: `${facts ? `What we know:\n${facts}\n\n` : ''}Email from ${fromName} <${fromEmail}>, subject "${row.subject}":\n\n${text}` }])).trim();
    }
    await rest('POST', 'mail_triage?on_conflict=id', { ...row, tenant_id: t?.id || null, category: c.category, urgency: c.urgency, summary: String(c.summary || '').slice(0, 300), needs_reply: !!c.needs_reply, draft },
      { Prefer: 'resolution=ignore-duplicates,return=minimal' });
    log('mail assistant:', c.category, c.urgency, t ? t.name : fromEmail, draft ? '(draft)' : '');
  }

  (async function loop() {
    await sleep(20000);
    for (;;) {
      try {
        const s = ((await rest('GET', 'app_settings?id=eq.mail_assistant&select=value'))[0]?.value) || {};
        if (s.enabled !== false && key()) {
          const list = await side({ action: 'list', account: ACCOUNT, mailbox: 'INBOX', limit: 40 });
          const since = new Date(Date.now() - (s.days_back || 3) * 86400000).toISOString();
          const fresh = (list.messages || []).filter((m) => m.uid && (!m.date || new Date(m.date).toISOString() >= since));
          if (fresh.length) {
            const seen = new Set((await rest('GET', `mail_triage?select=id&id=in.(${encodeURIComponent(fresh.map((m) => `"${String(m.uid).replace(/"/g, '')}"`).join(','))})`)).map((x) => x.id));
            for (const m of fresh.filter((x) => !seen.has(x.uid)).slice(0, 10)) {
              try { await handle(m); } catch (e) { log('mail assistant error', e.message); }
            }
            await rest('POST', 'rpc/refresh_actions', {}).catch(() => {});
          }
        }
      } catch (e) { log('mail assistant loop error', e.message); }
      await sleep(5 * 60 * 1000);
    }
  })();
};

'use strict';
// Weekly compliance digest. Reads compliance_items rows as JSON on stdin (piped
// from psql by a host cron), and emails office@ a list of certificates that are
// expired or expire within WINDOW_DAYS. Sends nothing when all is in order.
// Runs inside the mail-imap container so it reuses its nodemailer + SMTP creds.
const nodemailer = require('nodemailer');

const WINDOW_DAYS = Number(process.env.DIGEST_WINDOW_DAYS || 60);
const FROM_ACCOUNT = (process.env.DIGEST_ACCOUNT || 'office').toUpperCase();
const user = process.env[`MAIL_${FROM_ACCOUNT}_USER`];
const pass = process.env[`MAIL_${FROM_ACCOUNT}_PASS`];
const to = process.env.DIGEST_TO || user;

const LABELS = {
  gas_safety: 'Gas Safety (CP12)', eicr: 'EICR (electrical)', epc: 'EPC (energy)', insurance: 'Insurance',
  deposit_protection: 'Deposit protection', right_to_rent: 'Right to Rent', pat: 'PAT (appliances)', other: 'Other',
};
const fmt = (d) => new Date(d).toLocaleDateString('en-GB');
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

let input = '';
process.stdin.on('data', (c) => (input += c));
process.stdin.on('end', async () => {
  const rows = JSON.parse(input.trim() || '[]') || [];
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const due = rows
    .filter((r) => r.expiry_date)
    .map((r) => ({ ...r, days: Math.floor((new Date(r.expiry_date) - today) / 86400000) }))
    .filter((r) => r.days <= WINDOW_DAYS)
    .sort((a, b) => a.days - b.days);

  if (due.length === 0) { console.log('digest: nothing due'); return; }
  if (!user || !pass) { console.error('digest: mailbox not configured'); process.exit(1); }

  const expired = due.filter((r) => r.days < 0).length;
  const line = (r) => `${LABELS[r.type] || r.type} — ${r.unit_reference || 'Portfolio-wide'} — ` +
    (r.days < 0 ? `EXPIRED ${-r.days} days ago (${fmt(r.expiry_date)})` : `expires in ${r.days} days (${fmt(r.expiry_date)})`);
  const text = `PB Abbey — landlord compliance\n\n${due.length} certificate(s) need attention:\n\n` +
    due.map((r) => '• ' + line(r)).join('\n') + `\n\nManage them at https://pbabbey.com/tenant/compliance\n`;
  const html = `<div style="font-family:-apple-system,Segoe UI,Arial,sans-serif;color:#171717;font-size:14px">
<p style="margin:0 0 12px"><b>PB Abbey — landlord compliance</b></p>
<p style="margin:0 0 12px">${due.length} certificate(s) need attention${expired ? ` (<b style="color:#b91c1c">${expired} expired</b>)` : ''}:</p>
<table cellpadding="6" cellspacing="0" style="border-collapse:collapse;border:1px solid #e5e5e5;font-size:13px">
<tr style="background:#fafafa;text-align:left"><th>Certificate</th><th>Property</th><th>Expires</th><th>Status</th></tr>
${due.map((r) => `<tr style="border-top:1px solid #e5e5e5"><td>${esc(LABELS[r.type] || r.type)}</td><td>${esc(r.unit_reference || 'Portfolio-wide')}</td><td>${fmt(r.expiry_date)}</td><td style="color:${r.days < 0 ? '#b91c1c' : '#b45309'}">${r.days < 0 ? `Expired ${-r.days}d ago` : `In ${r.days} days`}</td></tr>`).join('\n')}
</table>
<p style="margin:16px 0 0"><a href="https://pbabbey.com/tenant/compliance">Open Compliance in PB Abbey</a></p></div>`;

  const t = nodemailer.createTransport({
    host: process.env.IONOS_SMTP_HOST || 'smtp.exchange.ionos.eu', port: Number(process.env.IONOS_SMTP_PORT || 587),
    secure: false, requireTLS: true, auth: { user, pass },
  });
  await t.sendMail({ from: user, to, subject: `Compliance: ${due.length} certificate(s) to renew${expired ? ` — ${expired} expired` : ''}`, text, html });
  console.log(`digest: sent ${due.length} item(s) to ${to}`);
});

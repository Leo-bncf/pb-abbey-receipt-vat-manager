'use strict';
// PB Abbey · weekly summary — every Monday at 8:00 (London), one internal email to
// Peter and Leo: what to do this week (from Actions), rent overdue, payments to
// confirm, lease dates coming up, new enquiries. Internal only: it goes to the
// addresses set in app_settings 'weekly_summary'.to, never to a tenant.
// Off until switched on in the app (Actions page). "Send a test" sends it once to
// the person who asked.
const APP = process.env.APP_URL || 'https://pbabbey.com';
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const gbp0 = (n) => `£${Math.round(Number(n) || 0).toLocaleString('en-GB')}`;
const dmy = (d) => (d ? new Date(`${String(d).slice(0, 10)}T12:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '');

module.exports = function startWeekly({ rest, log, sleep, transport }) {
  const get = async () => ((await rest('GET', 'app_settings?id=eq.weekly_summary&select=value'))[0]?.value) || {};
  const put = (value) => rest('POST', 'app_settings?on_conflict=id', { id: 'weekly_summary', value }, { Prefer: 'resolution=merge-duplicates,return=minimal' });

  async function build() {
    await rest('POST', 'rpc/refresh_actions', {}).catch(() => {});
    const actions = await rest('GET', 'actions?status=eq.open&select=*');
    const sev = { red: 0, amber: 1, neutral: 2 };
    actions.sort((a, b) => sev[a.severity] - sev[b.severity] || (Number(b.amount) || 0) - (Number(a.amount) || 0));
    const overdue = actions.filter((a) => a.kind === 'arrears');
    const toConfirm = actions.filter((a) => a.kind === 'bank_match');
    const enquiries = actions.filter((a) => a.kind === 'enquiry');
    const leases = actions.filter((a) => ['holding_over', 'lease_end', 'break', 'review'].includes(a.kind));
    const top = actions.filter((a) => !['arrears', 'bank_match', 'enquiry', 'no_contact'].includes(a.kind)).slice(0, 8);
    const since = new Date(Date.now() - 7 * 86400000).toISOString();
    const matched = await rest('GET', `bank_transactions?match_status=eq.matched&matched_date=gte.${since}&select=amount`).catch(() => []);
    const owed = overdue.reduce((s, a) => s + (Number(a.amount) || 0), 0);

    const li = (a, right) => `<tr><td style="padding:6px 0;border-bottom:1px solid #eee;font-size:13px">${a.severity === 'red' ? '<span style="color:#b91c1c">●</span> ' : ''}${esc(a.title)}</td><td style="padding:6px 0 6px 12px;border-bottom:1px solid #eee;font-size:13px;text-align:right;white-space:nowrap;color:#555">${right || ''}</td></tr>`;
    const amt = (a) => (Number(a.amount) > 0 ? (a.amount_kind === 'owed' ? gbp0(a.amount) : `${gbp0(a.amount)}/yr`) : '');
    const section = (title, rows) => (rows ? `<p style="margin:18px 0 6px;font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:#737373">${title}</p><table style="width:100%;border-collapse:collapse">${rows}</table>` : '');
    const lines = [];
    lines.push(`<p style="margin:0 0 4px;font-size:16px;font-weight:600">${actions.length} things to do this week</p>`);
    lines.push(`<p style="margin:0;color:#555;font-size:13px">${owed > 0 ? `${gbp0(owed)} of rent overdue · ` : ''}${toConfirm.length ? `${toConfirm.length} payments to confirm · ` : ''}${matched.length ? `${matched.length} payments matched by themselves this week` : 'everything else is up to date'}</p>`);
    lines.push(section('Most important', top.map((a) => li(a, amt(a))).join('')));
    lines.push(section('Rent overdue', overdue.slice(0, 8).map((a) => li(a, amt(a))).join('')));
    if (toConfirm.length) lines.push(section('Payments to confirm', toConfirm.slice(0, 6).map((a) => li(a)).join('')));
    if (enquiries.length) lines.push(section('New enquiries (To let page)', enquiries.map((a) => li(a)).join('')));
    if (leases.length) lines.push(section('Lease dates', leases.slice(0, 6).map((a) => li(a, a.due_date ? dmy(a.due_date) : '')).join('')));
    lines.push(`<p style="margin:22px 0 0"><a href="${APP}/tenant/actions" style="display:inline-block;background:#171717;color:#fff;text-decoration:none;padding:9px 16px;border-radius:4px;font-size:13px">Open Actions</a></p>`);
    lines.push('<p style="margin:16px 0 0;font-size:11px;color:#999">Internal summary for PB Abbey. Letters and invoices are prepared in the app and only sent when you click Send.</p>');
    const html = `<div style="background:#f5f4f1;padding:24px 0"><div style="max-width:600px;margin:0 auto;background:#fff;border:1px solid #e5e5e5;font-family:-apple-system,Segoe UI,Arial,sans-serif;color:#171717">`
      + '<div style="padding:14px 22px;border-bottom:1px solid #e5e5e5;font-weight:600">PB Abbey · this week</div>'
      + `<div style="padding:20px 22px">${lines.join('')}</div></div></div>`;
    const text = [`${actions.length} things to do this week.`, owed > 0 ? `${gbp0(owed)} of rent overdue.` : '', ...top.map((a) => `- ${a.title}`), '', `${APP}/tenant/actions`].filter(Boolean).join('\n');
    return { subject: `PB Abbey: ${actions.length} things to do this week${owed > 0 ? `, ${gbp0(owed)} overdue` : ''}`, html, text };
  }

  async function send(to) {
    const m = await build();
    await transport.sendMail({ from: `"PB Abbey" <${process.env.MAIL_OFFICE_USER}>`, to, subject: m.subject, html: m.html, text: m.text });
    log('weekly summary sent to', to);
  }

  (async function loop() {
    for (;;) {
      try {
        const s = await get();
        if (s.test_to) { await put({ ...s, test_to: null }); await send(s.test_to); }
        const now = new Date();
        const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', weekday: 'short', hour: '2-digit', hour12: false, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now).map((p) => [p.type, p.value]));
        const today = `${parts.year}-${parts.month}-${parts.day}`;
        if (s.enabled && parts.weekday === 'Mon' && Number(parts.hour) >= 8 && s.last_sent !== today && (s.to || []).length) {
          await put({ ...(await get()), last_sent: today });
          await send(s.to.join(', '));
        }
      } catch (e) { log('weekly summary error', e.message); }
      await sleep(5 * 60 * 1000);
    }
  })();
};

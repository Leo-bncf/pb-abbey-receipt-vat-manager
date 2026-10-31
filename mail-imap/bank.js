'use strict';
// PB Abbey · bank — reads PB Abbey's bank accounts through Enable Banking (Open
// Banking) and matches the money coming in to the rent lines. Read-only: it can
// see balances and transactions, it can never move money.
//
// How it is driven (no new endpoint): the app writes a row in public.bank_links
// ("requested"), this loop creates the bank consent link and writes it back; Peter
// approves at his bank, which sends him back to pbabbey.com/tenant/bank?code=…;
// the app stores the code ("code_received"), this loop turns it into a session
// and imports the accounts. Then transactions are read twice a day.
//
// Setup: RSA key at /app/secrets/enablebanking.pem (its certificate is uploaded
// to Enable Banking), application id in app_settings 'bank'.app_id.
// PSD2 allows about 4 unattended reads per account per day: we do 2, plus a
// "Sync now" from the app while under that limit.
const crypto = require('crypto');
const fs = require('fs');

const BASE = 'https://api.enablebanking.com';
const KEY_PATH = process.env.BANK_KEY_PATH || '/app/secrets/enablebanking.pem';
const REDIRECT = (process.env.APP_URL || 'https://pbabbey.com') + '/tenant/bank';
const DAILY_LIMIT = 4;
const SYNC_HOURS = [6, 18]; // London time

const b64url = (b) => Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

module.exports = function startBank({ rest, log, sleep }) {
  let key = null;
  const settings = async () => ((await rest('GET', 'app_settings?id=eq.bank&select=value'))[0]?.value) || {};
  const ready = async () => { const s = await settings(); return s.app_id && fs.existsSync(KEY_PATH) ? s : null; };

  function jwt(appId) {
    if (!key) key = crypto.createPrivateKey(fs.readFileSync(KEY_PATH, 'utf8'));
    const now = Math.floor(Date.now() / 1000);
    const head = b64url(JSON.stringify({ typ: 'JWT', alg: 'RS256', kid: appId }));
    const body = b64url(JSON.stringify({ iss: 'enablebanking.com', aud: 'api.enablebanking.com', iat: now, exp: now + 3600 }));
    return `${head}.${body}.${b64url(crypto.createSign('RSA-SHA256').update(`${head}.${body}`).sign(key))}`;
  }
  async function api(appId, path, init = {}) {
    const res = await fetch(BASE + path, { ...init, headers: { accept: 'application/json', 'content-type': 'application/json', authorization: `Bearer ${jwt(appId)}` } });
    const txt = await res.text(); let j = null; try { j = txt ? JSON.parse(txt) : null; } catch { j = txt; }
    if (!res.ok) throw new Error(`Enable Banking ${res.status}: ${(j && (j.message || j.error || j.detail)) || String(txt).slice(0, 200)}`);
    return j;
  }
  const patchLink = (id, v) => rest('PATCH', `bank_links?id=eq.${id}`, { ...v, updated_date: new Date().toISOString() });
  const logSync = (account_id, kind, ok, detail) => rest('POST', 'bank_sync_log', { account_id, kind, ok, detail: String(detail || '').slice(0, 500) }).catch(() => {});

  // ---- consent: requested -> awaiting_user -> code_received -> linked
  async function handleLinks(s) {
    // the list of banks, when the app asks for it (app_settings 'bank_request'.banks)
    const req = (await rest('GET', 'app_settings?id=eq.bank_request&select=value'))[0]?.value || {};
    if (req.banks) {
      await rest('PATCH', 'app_settings?id=eq.bank_request', { value: { ...req, banks: false } });
      try {
        const r = await api(s.app_id, `/aspsps?country=${s.country || 'GB'}`);
        const banks = (r.aspsps || []).map((a) => ({ name: a.name, psu_types: a.psu_types || [] })).sort((a, b) => a.name.localeCompare(b.name));
        await rest('POST', 'app_settings?on_conflict=id', { id: 'bank_list', value: { banks, at: new Date().toISOString() } }, { Prefer: 'resolution=merge-duplicates,return=minimal' });
      } catch (e) { await rest('POST', 'app_settings?on_conflict=id', { id: 'bank_list', value: { error: e.message, at: new Date().toISOString() } }, { Prefer: 'resolution=merge-duplicates,return=minimal' }); }
    }
    for (const l of await rest('GET', 'bank_links?status=eq.requested&select=*')) {
      try {
        const validUntil = new Date(Date.now() + 180 * 86400000).toISOString();
        const r = await api(s.app_id, '/auth', { method: 'POST', body: JSON.stringify({ access: { valid_until: validUntil }, aspsp: { name: l.aspsp_name, country: l.country }, state: l.state, redirect_url: REDIRECT, psu_type: s.psu_type || 'business' }) });
        await patchLink(l.id, { status: 'awaiting_user', auth_url: r.url, valid_until: validUntil, error: null });
        log('bank: consent link ready for', l.aspsp_name);
      } catch (e) { await patchLink(l.id, { status: 'error', error: e.message }); log('bank link error', e.message); }
    }
    for (const l of await rest('GET', 'bank_links?status=eq.code_received&select=*')) {
      try {
        const sess = await api(s.app_id, '/sessions', { method: 'POST', body: JSON.stringify({ code: l.code }) });
        await patchLink(l.id, { status: 'linked', session_id: sess.session_id, code: null, valid_until: sess.access?.valid_until || l.valid_until, error: null });
        for (const a of sess.accounts || []) {
          const uid = typeof a === 'string' ? a : a.uid; if (!uid) continue;
          const id = a.account_id || {};
          await rest('POST', 'bank_accounts?on_conflict=id', { id: uid, link_id: l.id, bank: l.aspsp_name, name: a.name || a.product || id.iban || l.aspsp_name,
            iban: id.iban || (id.other && id.other.identification) || null, currency: a.currency || 'GBP', active: true }, { Prefer: 'resolution=merge-duplicates,return=minimal' });
        }
        log('bank: linked', l.aspsp_name, (sess.accounts || []).length, 'accounts');
        await syncAll(s, true);
      } catch (e) { await patchLink(l.id, { status: 'error', error: e.message }); log('bank session error', e.message); }
    }
    // consents expire after 180 days
    for (const l of await rest('GET', `bank_links?status=eq.linked&valid_until=lt.${new Date().toISOString()}&select=id`)) await patchLink(l.id, { status: 'expired' });
  }

  // ---- transactions
  async function callsToday(accountId) {
    const since = new Date(); since.setUTCHours(0, 0, 0, 0);
    return (await rest('GET', `bank_sync_log?account_id=eq.${encodeURIComponent(accountId)}&kind=eq.transactions&created_date=gte.${since.toISOString()}&select=id`)).length;
  }
  function normalize(t, accountId) {
    const debit = String(t.credit_debit_indicator || '').toUpperCase() === 'DBIT';
    const amount = Math.abs(Number(t.transaction_amount?.amount || 0)) * (debit ? -1 : 1);
    const rem = Array.isArray(t.remittance_information) ? t.remittance_information.filter(Boolean).join(' ') : (t.remittance_information || '');
    const booked = String(t.booking_date || t.value_date || t.transaction_date || '').slice(0, 10) || null;
    const ref = t.entry_reference || t.transaction_id || crypto.createHash('sha1').update(`${accountId}|${booked}|${amount}|${rem}|${(debit ? t.creditor : t.debtor)?.name || ''}`).digest('hex');
    return { id: `${accountId}:${ref}`, account_id: accountId, booking_date: booked, value_date: t.value_date ? String(t.value_date).slice(0, 10) : null,
      amount: Math.round(amount * 100) / 100, currency: t.transaction_amount?.currency || 'GBP',
      counterparty: (debit ? t.creditor?.name : t.debtor?.name) || null, remittance: rem || null, raw: t };
  }
  async function syncAccount(s, a, force) {
    if (await callsToday(a.id) >= (force ? DAILY_LIMIT : DAILY_LIMIT - 1)) return log('bank: daily limit reached for', a.name);
    const from = a.last_sync ? new Date(new Date(a.last_sync).getTime() - 10 * 86400000) : new Date(Date.now() - 120 * 86400000);
    try {
      const out = []; let ck;
      for (let page = 0; page < 25; page++) {
        const q = new URLSearchParams({ date_from: from.toISOString().slice(0, 10) }); if (ck) q.set('continuation_key', ck);
        const r = await api(s.app_id, `/accounts/${a.id}/transactions?${q}`);
        out.push(...(r.transactions || []).filter((t) => String(t.status || '').toUpperCase() !== 'PDNG'));
        ck = r.continuation_key; if (!ck) break;
      }
      const rows = out.map((t) => normalize(t, a.id)).filter((x) => x.booking_date);
      for (let i = 0; i < rows.length; i += 200) await rest('POST', 'bank_transactions?on_conflict=id', rows.slice(i, i + 200), { Prefer: 'resolution=ignore-duplicates,return=minimal' });
      let balance = null;
      try { const b = await api(s.app_id, `/accounts/${a.id}/balances`); const x = (b.balances || [])[0]; balance = x ? Number(x.balance_amount?.amount) : null; } catch { /* balances optional */ }
      await rest('PATCH', `bank_accounts?id=eq.${encodeURIComponent(a.id)}`, { last_sync: new Date().toISOString(), ...(balance != null ? { balance, balance_date: new Date().toISOString() } : {}) });
      await logSync(a.id, 'transactions', true, `${rows.length} transactions`);
      log('bank: synced', a.name, rows.length);
    } catch (e) { await logSync(a.id, 'transactions', false, e.message); log('bank sync error', a.name, e.message); }
  }
  async function syncAll(s, force) {
    for (const a of await rest('GET', 'bank_accounts?active=eq.true&select=*')) await syncAccount(s, a, force);
    const n = await rest('POST', 'rpc/match_bank_transactions', {});
    if (n) log('bank: matched', n, 'payments automatically');
    await rest('POST', 'rpc/refresh_actions', {}).catch(() => {});
  }

  let lastSlot = '';
  (async function loop() {
    for (;;) {
      try {
        const s = await ready();
        if (s) {
          await handleLinks(s);
          const now = new Date(); const h = Number(now.toLocaleString('en-GB', { timeZone: 'Europe/London', hour: '2-digit', hour12: false }));
          const slot = `${now.toISOString().slice(0, 10)}-${h}`;
          if (SYNC_HOURS.includes(h) && slot !== lastSlot) { lastSlot = slot; await syncAll(s, false); }
          const req = (await rest('GET', 'app_settings?id=eq.bank_request&select=value'))[0]?.value || {};
          if (req.sync) { await rest('PATCH', 'app_settings?id=eq.bank_request', { value: { ...req, sync: false } }); await syncAll(s, true); }
        }
      } catch (e) { log('bank loop error', e.message); }
      await sleep(30 * 1000);
    }
  })();
};

// Gemini receipt engine: split the PDF into single pages, find every receipt
// on each page with its bounding box (Gemini Flash), and have a second,
// independent reader (Gemini Pro) re-read the same page. Each Flash receipt is
// matched to the Pro receipt with the most-overlapping box; if they disagree on
// amount or date (or Pro didn't see it) the receipt is flagged for review.
// Measured on doc 57: 63/69 auto-agree, the 6 flagged were the ambiguous ones.
import { PDFDocument } from 'pdf-lib';

const API = 'https://generativelanguage.googleapis.com/v1beta/models';
const PRIMARY = 'gemini-3.8-flash';   // full thinking: low thinking misread digits (£8.46 -> £18.46)
const VERIFIER = 'gemini-3.1-pro-preview';

const promptFor = (period) => `This is ONE scanned page from a UK company's expense pack. Separate paper till receipts
(and sometimes card-payment slips) are pasted on it: there may be one or many, possibly rotated,
overlapping or partly cut off.

Find EVERY distinct physical piece of paper that is a receipt. Rules:
- One receipt = one separate piece of paper with its own merchant header and its own final total.
- Never split one receipt into several: its sub-total, discounts, VAT summary and the card-payment
  section printed on the SAME paper all belong to it. Use the FINAL amount paid as total_amount.
- A separate card-terminal slip (merchant/customer copy) pasted next to the receipt it pays (same
  amount) is part of that receipt, not a new one. Only if a card slip stands alone with no matching
  receipt, report it with is_card_slip_only=true.
- Item lines (e.g. "Americano", "Pain aux raisins") are never vendors.
- NEVER invent. Every value must be read from the paper. If something is unreadable, use null and
  set legible=false. Do not guess a famous chain name that is not printed.
${period ? `- The pack covers ${period}; dates should fall in that window (check the year carefully).` : `- These are recent receipts: today is ${new Date().toISOString().slice(0, 10)}, so dates are on or before today and normally within the last few months. Read the year very carefully (a faint 6 is often mis-read as 4 or 5).`}

For each receipt return box_2d = [ymin, xmin, ymax, xmax] normalised 0-1000 around the WHOLE paper,
plus the fields. total_text = the exact characters printed for the final total (e.g. "£12.45").
vat_amount = the VAT amount printed on the receipt (null if none printed).
vat_rate = the VAT rate printed (e.g. 20). If NO rate is printed, infer the UK rate from what was bought
and set vat_inferred=true: eat-in food, hot takeaway food, restaurant/café/pub, alcohol, soft drinks,
confectionery, fuel, toiletries, household and other non-food goods = 20; cold takeaway food and basic
groceries, books/newspapers, public transport, postage = 0. Mixed basket with no breakdown: use the
rate of the main items and say so in notes. Non-UK receipts: vat_rate null.
country = country of the shop (from address/currency).`;

// Carnas (family house in France): invoices from tradesmen/companies and till
// receipts, in euros, French VAT (TVA) 20 / 10 / 5.5 / 2.1 %.
const promptForFR = (period) => `This is ONE scanned page (or photo) of expense documents for a private house in France:
supplier invoices (factures, devis signed as paid, tradesmen's bills) and/or till receipts (tickets de caisse).
There may be one or several separate documents on the page.

Find EVERY distinct document. Rules:
- One document = one invoice or one receipt with its own supplier header and its own final total.
- A multi-line invoice is ONE document: never split its lines. Use the final amount paid,
  "Total TTC" / "Net à payer", as total_amount (not the HT amount, not a deposit already deducted).
- A card-terminal slip next to the receipt it pays (same amount) is part of it. A card slip alone:
  report it with is_card_slip_only=true.
- NEVER invent. Every value must be read from the paper. Unreadable -> null and legible=false.
${period ? `- The documents cover ${period}; dates should fall in that window (check the year carefully).` : `- Today is ${new Date().toISOString().slice(0, 10)}: dates are on or before today. Read the year very carefully.`}
- French dates are day/month/year (03/04/2026 = 3 April 2026).

For each document return box_2d = [ymin, xmin, ymax, xmax] normalised 0-1000 around the WHOLE document,
plus the fields. total_text = the exact characters printed for the final total (e.g. "1 234,56 €").
Amounts use a comma for decimals in France: "1 234,56" = 1234.56.
vat_amount = the TVA amount printed (sum of all TVA lines if several rates; null if none printed).
vat_rate = the TVA rate printed (20, 10, 5.5 or 2.1). Several rates on one document: the rate of the largest
part, and list each rate with its amount in notes. If NO TVA is printed, infer the French rate and set
vat_inferred=true: renovation/maintenance work on a home over 2 years old done by a company = 10, energy-saving
work = 5.5, most goods, materials bought in a shop, utilities' subscriptions, fees = 20, food in a shop = 5.5.
"TVA non applicable, art. 293 B du CGI" printed = no VAT: vat_rate 0, vat_amount 0, vat_explicit=true.
vat_explicit = true when the TVA amount is printed on the document.
country = country of the supplier (normally France).`;

const SCHEMA = {
  type: 'OBJECT',
  properties: { receipts: { type: 'ARRAY', items: { type: 'OBJECT', properties: {
    box_2d: { type: 'ARRAY', items: { type: 'INTEGER' } },
    vendor_name: { type: 'STRING', nullable: true },
    receipt_date: { type: 'STRING', nullable: true, description: 'YYYY-MM-DD' },
    total_amount: { type: 'NUMBER', nullable: true },
    total_text: { type: 'STRING', nullable: true },
    currency: { type: 'STRING', nullable: true },
    country: { type: 'STRING', nullable: true },
    vat_amount: { type: 'NUMBER', nullable: true },
    vat_rate: { type: 'NUMBER', nullable: true },
    vat_explicit: { type: 'BOOLEAN' },
    vat_inferred: { type: 'BOOLEAN' },
    is_card_slip_only: { type: 'BOOLEAN' },
    legible: { type: 'BOOLEAN' },
    confidence: { type: 'INTEGER' },
    notes: { type: 'STRING', nullable: true },
  }, required: ['box_2d', 'vendor_name', 'total_amount', 'legible', 'confidence'] } } },
  required: ['receipts'],
};

function b64(u8) {
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  return btoa(s);
}

// Adds one billed API call to the per-request usage tally (returned to the caller,
// which logs it in public.api_usage for the Billing page).
export function addUsage(usage, model, { input = 0, output = 0, pages = 0 } = {}) {
  if (!usage) return;
  const u = (usage[model] ||= { calls: 0, input: 0, output: 0, pages: 0 });
  u.calls += 1; u.input += input; u.output += output; u.pages += pages;
}

async function readPage(apiKey, model, page, prompt, usage) {
  const body = JSON.stringify({
    contents: [{ role: 'user', parts: [{ inline_data: { mime_type: page.mime, data: page.data } }, { text: prompt }] }],
    generationConfig: { temperature: 0, responseMimeType: 'application/json', responseSchema: SCHEMA, mediaResolution: 'MEDIA_RESOLUTION_HIGH' },
  });
  let last;
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(`${API}/${model}:generateContent`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey }, body });
    if (res.ok) {
      const j = await res.json();
      const m = j?.usageMetadata || {};
      // Thinking tokens are billed at the output rate.
      addUsage(usage, model, { input: m.promptTokenCount || 0, output: (m.candidatesTokenCount || 0) + (m.thoughtsTokenCount || 0) });
      const parts = j?.candidates?.[0]?.content?.parts || [];
      const txt = parts.filter((p) => !p.thought).map((p) => p.text || '').join('');
      return JSON.parse(txt || '{"receipts":[]}').receipts || [];
    }
    last = `${model} ${res.status}: ${(await res.text()).slice(0, 160)}`;
    if (res.status !== 429 && res.status < 500) break;       // client error: don't retry
    await new Promise((r) => setTimeout(r, 3000 * (attempt + 1)));
  }
  throw new Error(last);
}

const iou = (a, b) => {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== 4 || b.length !== 4) return 0;
  const [y0, x0, y1, x1] = a, [Y0, X0, Y1, X1] = b;
  const iw = Math.max(0, Math.min(x1, X1) - Math.max(x0, X0)), ih = Math.max(0, Math.min(y1, Y1) - Math.max(y0, Y0));
  const i = iw * ih, u = (x1 - x0) * (y1 - y0) + (X1 - X0) * (Y1 - Y0) - i;
  return u > 0 ? i / u : 0;
};
const sameAmt = (a, b) => a != null && b != null && Math.abs(Number(a) - Number(b)) < 0.011;
const CUR = { '£': 'GBP', '€': 'EUR', '$': 'USD', GBP: 'GBP', EUR: 'EUR', USD: 'USD' };
const normCur = (c, dflt = 'GBP') => CUR[(c || '').trim().toUpperCase()] || CUR[(c || '').trim()] || dflt;
const COUNTRY = { uk: 'United Kingdom', gb: 'United Kingdom', gbr: 'United Kingdom', unitedkingdom: 'United Kingdom', england: 'United Kingdom',
  greatbritain: 'United Kingdom', britain: 'United Kingdom', scotland: 'United Kingdom', wales: 'United Kingdom', fr: 'France', fra: 'France', france: 'France' };
const normCountry = (c, cur) => COUNTRY[(c || '').toLowerCase().replace(/[^a-z]/g, '')] || c || (cur === 'EUR' ? '' : 'United Kingdom');
const normDate = (d) => (/^\d{4}-\d{2}-\d{2}$/.test(d || '') ? d : null);

// A stand-alone card slip (or a vendor-less box) with the same total as a real
// receipt on the same page is that receipt's payment slip, not a new purchase.
function mergeSlips(list) {
  return list.filter((r) => {
    const slipLike = r.is_card_slip_only || !r.vendor_name;
    if (!slipLike) return true;
    return !list.some((o) => o !== r && !o.is_card_slip_only && o.vendor_name && sameAmt(o.total_amount, r.total_amount));
  });
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length); let i = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); }
  }));
  return out;
}

export async function extractWithGemini({ fileUrl, period, apiKey, usage, region = 'UK' }) {
  const fr = region === 'FR';
  const res = await fetch(fileUrl);
  if (!res.ok) throw new Error(`could not fetch document (${res.status})`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  const isPdf = bytes[0] === 0x25 && bytes[1] === 0x50; // "%P"
  // Images (jpg/png uploads) are sent as a single page as-is.
  let pages;
  if (isPdf) {
    const src = await PDFDocument.load(bytes, { ignoreEncryption: true });
    pages = [];
    for (let k = 0; k < src.getPageCount(); k++) {
      const d = await PDFDocument.create();
      const [p] = await d.copyPages(src, [k]);
      d.addPage(p);
      pages.push({ mime: 'application/pdf', data: b64(await d.save()) });
    }
  } else {
    const mime = res.headers.get('content-type') || 'image/jpeg';
    pages = [{ mime, data: b64(bytes) }];
  }

  const prompt = fr ? promptForFR(period) : promptFor(period);
  const errors = [];
  const perPage = await mapLimit(pages, 10, async (pg, idx) => {
    const call = (model) => readPage(apiKey, model, pg, prompt, usage).catch((e) => { errors.push(`p${idx + 1} ${String(e.message || e).slice(0, 120)}`); return null; });
    const [primary, verifier] = await Promise.all([call(PRIMARY), call(VERIFIER)]);
    if (!primary) return [];
    const ver = mergeSlips(verifier || []);
    return mergeSlips(primary).map((r) => {
      const best = ver.reduce((b, v) => (iou(r.box_2d, v.box_2d) > (b ? iou(r.box_2d, b.box_2d) : 0) ? v : b), null);
      let verification;
      if (!verifier) verification = 'verifier unavailable';
      else if (!best || iou(r.box_2d, best.box_2d) < 0.3) verification = 'seen by one reader only';
      else if (!sameAmt(best.total_amount, r.total_amount)) verification = 'amount differs';
      else if ((best.receipt_date || null) !== (r.receipt_date || null)) verification = 'date differs';
      else verification = 'OK';
      return {
        vendor_name: r.vendor_name || '',
        receipt_date: normDate(r.receipt_date),
        country: fr ? (normCountry(r.country, 'EUR') || 'France') : normCountry(r.country, normCur(r.currency)),
        currency: normCur(r.currency, fr ? 'EUR' : 'GBP'),
        total_amount: r.total_amount,
        vat_amount: r.vat_amount ?? 0,
        vat_rate: r.vat_rate ?? 0,
        vat_explicit: !!r.vat_explicit && r.vat_amount != null,
        vat_inferred: !!r.vat_inferred,
        is_tax_free: false,
        ocr_text: r.total_text ? `Total printed: ${r.total_text}` : '',
        extraction_notes: [r.notes, r.vat_inferred ? `VAT rate inferred (${r.vat_rate ?? 0}%) — not printed on the receipt` : '', r.legible === false ? 'partly illegible' : '', r.is_card_slip_only ? 'card slip only (no receipt found)' : '',
          verification !== 'OK' ? `second reader: ${verification}${best ? ` (read ${best.total_amount ?? '?'} / ${best.receipt_date ?? '?'})` : ''}` : ''].filter(Boolean).join('; '),
        confidence_score: Math.max(0, Math.min(100, Math.round(Number(r.confidence) || 50))),
        receipt_location: `page ${idx + 1}`,
        page_number: idx + 1,
        box_2d: r.box_2d,
        verification,
        verifier_amount: best ? best.total_amount ?? null : null,
        verifier_date: best ? normDate(best.receipt_date) : null,
      };
    });
  });
  return { receipts: perPage.flat(), pages: pages.length, errors, engine: `${PRIMARY}+${VERIFIER}` };
}

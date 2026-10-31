// Cloudflare Worker: receipt extraction via YOUR Mistral API key.
// Reads a PDF/image with Mistral OCR (all pages, no page cap), then structures
// EACH page separately into receipts JSON. The Mistral key lives as a Worker
// secret (env.MISTRAL_API_KEY) — never in the browser. This replaces the
// base44 backend function so base44 is out of the AI path entirely.
//
// Deploy: see worker/README.md. The frontend POSTs { file_url, prompt } here.

const OCR = "https://api.mistral.ai/v1/ocr";
const CHAT = "https://api.mistral.ai/v1/chat/completions";

import { extractWithGemini, addUsage } from "./gemini.js";

// Browser origins allowed to call this Worker (the self-hosted app).
const ALLOWED_ORIGINS = ["https://pbabbey.com", "https://www.pbabbey.com", "https://pb-abbey-app.leo-bncf.workers.dev"];

function corsHeaders(origin) {
  const allow = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    Vary: "Origin",
  };
}

function json(obj, status, origin) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders(origin) },
  });
}

async function withRetry(fn, attempts = 4) {
  let last;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      if (i < attempts - 1) await new Promise((r) => setTimeout(r, 1500 * (i + 1)));
    }
  }
  throw last;
}

async function mistralJson(url, apiKey, payload, usage) {
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    throw new Error(`Mistral ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
  const j = await res.json();
  if (j?.usage_info?.pages_processed) addUsage(usage, payload.model, { pages: j.usage_info.pages_processed });
  else if (j?.usage) addUsage(usage, payload.model, { input: j.usage.prompt_tokens || 0, output: j.usage.completion_tokens || 0 });
  return j;
}

// Limited concurrency so we stay under the Worker subrequest budget and Mistral rate limits.
async function mapLimit(items, limit, fn) {
  const out = [];
  for (let i = 0; i < items.length; i += limit) {
    const batch = items.slice(i, i + limit);
    const r = await Promise.all(batch.map((it, j) => fn(it, i + j)));
    out.push(...r);
  }
  return out;
}

const SCHEMA_HINT =
  `Return ONLY JSON of this exact shape: { "receipts": [ { "vendor_name": string, ` +
  `"receipt_date": "YYYY-MM-DD", "country": string, "currency": string, "total_amount": number, ` +
  `"vat_amount": number, "vat_rate": number, "vat_explicit": boolean, "is_tax_free": boolean, ` +
  `"ocr_text": string, "extraction_notes": string, "confidence_score": number, ` +
  `"receipt_location": string } ] }. If the page has no receipt, return { "receipts": [] }. ` +
  `RULES: vendor_name = the clean business name ONLY (no parentheses, no notes, no commentary — ` +
  `put any uncertainty in extraction_notes instead). receipt_date = exactly as printed in YYYY-MM-DD. ` +
  `Read the YEAR digits very carefully: these are recent receipts, so the year is the current year or ` +
  `the one before. A year that reads as 2006, 2016, 2023, 2025 etc. on an otherwise recent receipt is ` +
  `almost always a mis-read of a 202x year — re-read it before trusting it. Never invent a total or VAT; ` +
  `if a number is unreadable leave it and note it in extraction_notes. ` +
  `A "Sub Total"/"Subtotal" line is NOT a separate receipt: it belongs to the same receipt as its final ` +
  `"Total" (after any discounts/promotions). Always use the final Total and NEVER emit a second receipt ` +
  `for the sub total. ONLY extract receipts that are literally present in the OCR text: every vendor_name ` +
  `you output MUST actually appear in the text below. Never add a well-known chain (Pret A Manger, Caffè ` +
  `Nero, Costa, Starbucks, McDonald's, Greggs, etc.) unless that name is printed in this text.`;

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    if (request.method === "OPTIONS") return new Response(null, { headers: corsHeaders(origin) });
    if (request.method !== "POST") return json({ error: "Use POST" }, 405, origin);

    const apiKey = env.MISTRAL_API_KEY;
    if (!apiKey) return json({ error: "MISTRAL_API_KEY secret is not set on the Worker" }, 500, origin);

    let body = {};
    try {
      body = await request.json();
    } catch {
      /* ignore */
    }
    const fileUrl = body.file_url;
    const userPrompt = body.prompt || "";
    const period = body.period || ""; // e.g. "August-September 2026" — expected date window
    if (!fileUrl) return json({ error: "file_url is required" }, 400, origin);

    // Default engine: Gemini (page split + bounding boxes + second-reader check).
    // Mistral stays available as a fallback: { engine: "mistral" }.
    const engine = body.engine || (env.GEMINI_API_KEY ? "gemini" : "mistral");
    const usage = {}; // { model: { calls, input, output, pages } } — every billed call, incl. a failed Gemini try before a fallback
    if (engine === "gemini" && !body.debug) {
      let geminiProblem = "";
      try {
        const out = await extractWithGemini({ fileUrl, period, apiKey: env.GEMINI_API_KEY, usage, region: body.region === 'FR' ? 'FR' : 'UK' });
        // Gemini unusable (credits depleted, quota, outage) -> every page failed and
        // nothing came back. Never return an empty result as if the document had no
        // receipts: fall through to the Mistral engine instead.
        const allFailed = out.receipts.length === 0 && out.errors.length > 0;
        if (!allFailed) return json({ receipts: out.receipts, ocr_pages: out.pages, errors: out.errors, engine: out.engine, usage }, 200, origin);
        geminiProblem = out.errors[0] || "no result";
      } catch (e) {
        geminiProblem = String(e?.message || e);
      }
      console.warn("gemini failed, falling back to mistral:", geminiProblem.slice(0, 200));
      body.fallbackReason = geminiProblem.slice(0, 200);
    }

    const periodRule = period
      ? `IMPORTANT DATE CONSTRAINT: every receipt in this document is from ${period}. ` +
        `Each receipt_date MUST fall within ${period}. If your reading gives a date outside that ` +
        `window (especially a different year like 2023/2024/2025), you mis-read it — correct the ` +
        `year (and month if needed) so it fits ${period}. `
      : "";

    try {
      // 1) OCR every page.
      const ocr = await withRetry(() =>
        mistralJson(OCR, apiKey, {
          model: "mistral-ocr-latest",
          document: { type: "document_url", document_url: fileUrl },
        }, usage)
      );
      const pages = ocr.pages || [];

      // Debug: return raw OCR text per page (no structuring) to inspect coverage.
      if (body.debug) {
        return json({
          ocr_pages: pages.length,
          pagesDebug: pages.map((p, i) => ({ page: i + 1, len: (p?.markdown || "").length, markdown: p?.markdown || "" })),
        }, 200, origin);
      }

      // 2) Structure each page separately so no receipt is dropped.
      //    Concurrency 3: proven 0 errors on doc 57 (68 receipts). Higher (8)
      //    trips Mistral's rate limit (429) and drops receipts. Reliability wins.
      const pageErrors = [];
      const perPage = await mapLimit(pages, 3, async (p, idx) => {
        const text = (p?.markdown || "").trim();
        if (!text) return [];
        const instructions =
          (body.region === "FR" ? "These are FRENCH expense documents (invoices and receipts, euros, French TVA 20/10/5.5/2.1%). total_amount = Total TTC / Net à payer. Decimal comma: 1 234,56 = 1234.56. Dates are day/month/year.\n\n" : "") +
          (userPrompt ? userPrompt + "\n\n" : "") +
          periodRule +
          `The following is the OCR text of PAGE ${idx + 1} of a document. This page usually has ` +
          `SEVERAL separate till receipts pasted on it. FIRST count how many distinct receipts are on ` +
          `the page — each one has its own store name/header and its own TOTAL line (count the TOTAL ` +
          `lines). THEN output exactly that many objects, one per receipt. Do NOT stop early, do NOT ` +
          `merge two receipts, do NOT skip small ones. It is better to return more receipts than to ` +
          `miss any. Set receipt_location to "page ${idx + 1}". ` +
          SCHEMA_HINT +
          `\n\nPAGE ${idx + 1} OCR TEXT:\n` +
          text;
        const runChat = async (content) => {
          const chat = await withRetry(() =>
            mistralJson(CHAT, apiKey, {
              model: "mistral-large-latest",
              temperature: 0,
              max_tokens: 8000,
              response_format: { type: "json_object" },
              messages: [{ role: "user", content }],
            }, usage)
          );
          const parsed = JSON.parse(chat?.choices?.[0]?.message?.content || "{}");
          return Array.isArray(parsed.receipts) ? parsed.receipts : [];
        };
        const key = (r) => `${(r.vendor_name || "").toLowerCase().trim()}|${r.total_amount ?? ""}`;
        // Drop any receipt whose vendor name does not actually appear in the
        // page's OCR text — this kills gap-finder hallucinations (e.g. it would
        // invent a "Pret A Manger" or "Caffè Nero" receipt not on the page).
        const norm = (s) => (s || "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
        const pageText = norm(text);
        const vendorInText = (r) => {
          const words = norm(r.vendor_name).split(/[^a-z0-9]+/).filter((w) => w.length >= 4);
          if (words.length === 0) return true; // nothing checkable → keep
          return words.some((w) => pageText.includes(w));
        };
        try {
          const merged = await runChat(instructions);
          const seen = new Set(merged.map(key));
          // Gap-finder for dense pages: re-read the SAME page for receipts missed
          // so far. Bounded to 2 passes and tightly worded so it recovers genuinely
          // missed receipts WITHOUT inventing ones or splitting a sub total.
          for (let pass = 0; pass < 2; pass++) {
            const found = merged.map((r) => `${r.vendor_name || "?"} / ${r.total_amount ?? "?"}`).join("; ");
            const gapInstr =
              periodRule +
              `Below is the OCR text of PAGE ${idx + 1}. These receipts were ALREADY extracted: ` +
              `[${found}]. Return ONLY receipts that are clearly printed in the text but genuinely ` +
              `MISSING from that list — i.e. a different store, or the same store but a clearly separate ` +
              `transaction (different transaction/receipt number or time). Do NOT re-report one already ` +
              `listed. Do NOT treat a Sub Total as a new receipt. Do NOT invent a receipt that is not ` +
              `printed in the text. If none are missing, return {"receipts":[]}. ` +
              `Set receipt_location to "page ${idx + 1}". ` +
              SCHEMA_HINT + `\n\nPAGE ${idx + 1} OCR TEXT:\n` + text;
            let extra = [];
            try { extra = await runChat(gapInstr); } catch (e) { pageErrors.push(`p${idx + 1} gap: ${String(e?.message || e).slice(0, 60)}`); break; }
            const newOnes = extra.filter((r) => !seen.has(key(r)) && vendorInText(r));
            if (newOnes.length === 0) break; // converged
            for (const r of newOnes) { seen.add(key(r)); merged.push(r); }
          }
          // Main-pass receipts are trusted (they may correct a garbled OCR
          // vendor, e.g. "ELECTRICFIX" -> "Screwfix"); only gap additions above
          // are vendorInText-filtered to kill hallucinations.
          return merged;
        } catch (e) {
          pageErrors.push(`p${idx + 1} pass1: ${String(e?.message || e).slice(0, 80)}`);
          return [];
        }
      });

      // Normalize confidence to a 0-100 integer (the model sometimes returns 0-1).
      const receipts = perPage.flat().map((r) => {
        let c = Number(r.confidence_score);
        if (!isFinite(c)) c = 50;
        if (c > 0 && c <= 1) c = c * 100;
        r.confidence_score = Math.round(Math.max(0, Math.min(100, c)));
        return r;
      });
      return json({ receipts, ocr_pages: pages.length, errors: pageErrors, engine: "mistral", usage, ...(body.fallbackReason ? { fallback_reason: body.fallbackReason } : {}) }, 200, origin);
    } catch (e) {
      return json({ error: String(e?.message || e) }, 502, origin);
    }
  },
};

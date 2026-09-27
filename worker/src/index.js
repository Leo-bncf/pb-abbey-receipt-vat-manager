// Cloudflare Worker: receipt extraction via YOUR Mistral API key.
// Reads a PDF/image with Mistral OCR (all pages, no page cap), then structures
// EACH page separately into receipts JSON. The Mistral key lives as a Worker
// secret (env.MISTRAL_API_KEY) — never in the browser. This replaces the
// base44 backend function so base44 is out of the AI path entirely.
//
// Deploy: see worker/README.md. The frontend POSTs { file_url, prompt } here.

const OCR = "https://api.mistral.ai/v1/ocr";
const CHAT = "https://api.mistral.ai/v1/chat/completions";

// Only allow the base44 app to call this from a browser.
const ALLOW_ORIGIN = "https://pb-abbey-receipts.base44.app";

function corsHeaders(origin) {
  const allow = origin === ALLOW_ORIGIN ? origin : ALLOW_ORIGIN;
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

async function withRetry(fn, attempts = 3) {
  let last;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      if (i < attempts - 1) await new Promise((r) => setTimeout(r, 800 * (i + 1)));
    }
  }
  throw last;
}

async function mistralJson(url, apiKey, payload) {
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    throw new Error(`Mistral ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
  return res.json();
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
  `if a number is unreadable leave it and note it in extraction_notes.`;

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
        })
      );
      const pages = ocr.pages || [];

      // 2) Structure each page separately so no receipt is dropped.
      //    Concurrency 6 keeps long docs fast while staying under rate limits.
      const perPage = await mapLimit(pages, 6, async (p, idx) => {
        const text = (p?.markdown || "").trim();
        if (!text) return [];
        const instructions =
          (userPrompt ? userPrompt + "\n\n" : "") +
          periodRule +
          `The following is the OCR text of PAGE ${idx + 1} of a document. It may contain ONE or MORE ` +
          `separate till receipts / tickets. Extract EVERY distinct receipt on this page — never skip ` +
          `one and never merge two into one. Set receipt_location to "page ${idx + 1}". ` +
          SCHEMA_HINT +
          `\n\nPAGE ${idx + 1} OCR TEXT:\n` +
          text;
        try {
          const chat = await withRetry(() =>
            mistralJson(CHAT, apiKey, {
              model: "mistral-large-latest",
              temperature: 0,
              response_format: { type: "json_object" },
              messages: [{ role: "user", content: instructions }],
            })
          );
          const parsed = JSON.parse(chat?.choices?.[0]?.message?.content || "{}");
          return Array.isArray(parsed.receipts) ? parsed.receipts : [];
        } catch (_e) {
          return [];
        }
      });

      return json({ receipts: perPage.flat(), ocr_pages: pages.length }, 200, origin);
    } catch (e) {
      return json({ error: String(e?.message || e) }, 502, origin);
    }
  },
};

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

      // Debug: return raw OCR text per page (no structuring) to inspect coverage.
      if (body.debug) {
        return json({
          ocr_pages: pages.length,
          pagesDebug: pages.map((p, i) => ({ page: i + 1, len: (p?.markdown || "").length, markdown: p?.markdown || "" })),
        }, 200, origin);
      }

      // 2) Structure each page separately so no receipt is dropped.
      //    Concurrency 8 (Workers Paid lifts the subrequest cap to 1000) — much
      //    faster on long docs while staying within Mistral paid-tier limits.
      const pageErrors = [];
      const perPage = await mapLimit(pages, 8, async (p, idx) => {
        const text = (p?.markdown || "").trim();
        if (!text) return [];
        const instructions =
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
            })
          );
          const parsed = JSON.parse(chat?.choices?.[0]?.message?.content || "{}");
          return Array.isArray(parsed.receipts) ? parsed.receipts : [];
        };
        try {
          const first = await runChat(instructions);
          // Pass 2: gap-finder for receipts missed on dense pages.
          const found = first.map((r) => `${r.vendor_name || "?"} / ${r.total_amount ?? "?"}`).join("; ");
          const gapInstr =
            periodRule +
            `Below is the OCR text of PAGE ${idx + 1}. These receipts were ALREADY extracted: ` +
            `[${found}]. Re-read the text and return ONLY receipts present but NOT already in that ` +
            `list (a different store, or same store with a different TOTAL). If none are missing, ` +
            `return {"receipts":[]}. Set receipt_location to "page ${idx + 1}". ` +
            SCHEMA_HINT + `\n\nPAGE ${idx + 1} OCR TEXT:\n` + text;
          let extra = [];
          try { extra = await runChat(gapInstr); } catch (e) { pageErrors.push(`p${idx + 1} pass2: ${String(e?.message || e).slice(0, 80)}`); }
          const key = (r) => `${(r.vendor_name || "").toLowerCase().trim()}|${r.total_amount ?? ""}`;
          const seen = new Set(first.map(key));
          const merged = [...first];
          for (const r of extra) if (!seen.has(key(r))) { seen.add(key(r)); merged.push(r); }
          return merged;
        } catch (e) {
          pageErrors.push(`p${idx + 1} pass1: ${String(e?.message || e).slice(0, 80)}`);
          return [];
        }
      });

      return json({ receipts: perPage.flat(), ocr_pages: pages.length, errors: pageErrors }, 200, origin);
    } catch (e) {
      return json({ error: String(e?.message || e) }, 502, origin);
    }
  },
};

// Base44 backend function (Deno). Reads a receipt PDF/image with Mistral OCR
// (all pages, no page cap), then structures EACH page separately into receipts
// JSON. Per-page structuring avoids the under-extraction that happens when one
// chat call has to return every receipt from a long dense document.
// Uses the MISTRAL_API_KEY secret server-side. Invoke with:
//   base44.functions.invoke('extractReceiptsMistral', { file_url, prompt })

const OCR = "https://api.mistral.ai/v1/ocr/process";
const CHAT = "https://api.mistral.ai/v1/chat/completions";

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

// Run async work over items with limited concurrency (avoids rate limits).
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
  `"receipt_location": string } ] }. If the page has no receipt, return { "receipts": [] }.`;

Deno.serve(async (req) => {
  try {
    if (req.method !== "POST") return Response.json({ error: "Use POST" }, { status: 405 });
    const apiKey = Deno.env.get("MISTRAL_API_KEY");
    if (!apiKey) return Response.json({ error: "MISTRAL_API_KEY not set" }, { status: 500 });

    const body = await req.json().catch(() => ({}));
    const fileUrl = body.file_url;
    const userPrompt = body.prompt || "";
    if (!fileUrl) return Response.json({ error: "file_url is required" }, { status: 400 });

    // 1) OCR every page of the document.
    const ocr = await withRetry(() =>
      mistralJson(OCR, apiKey, {
        model: "mistral-ocr-latest",
        document: { type: "document_url", document_url: fileUrl },
      })
    );
    const pages = ocr.pages || [];

    // 2) Structure each page on its own so no receipt is dropped.
    const perPage = await mapLimit(pages, 4, async (p, idx) => {
      const text = (p?.markdown || "").trim();
      if (!text) return [];
      const instructions =
        (userPrompt ? userPrompt + "\n\n" : "") +
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
        // Don't fail the whole document because one page errored.
        return [];
      }
    });

    const receipts = perPage.flat();
    return Response.json({ receipts, ocr_pages: pages.length });
  } catch (e) {
    return Response.json({ error: String(e?.message || e) }, { status: 502 });
  }
});

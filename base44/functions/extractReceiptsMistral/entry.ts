const OCR = "https://api.mistral.ai/v1/ocr/process";
const CHAT = "https://api.mistral.ai/v1/chat/completions";

Deno.serve(async (req) => {
  try {
    if (req.method !== "POST") return Response.json({ error: "Use POST" }, { status: 405 });
    const apiKey = Deno.env.get("MISTRAL_API_KEY");
    if (!apiKey) return Response.json({ error: "MISTRAL_API_KEY not set" }, { status: 500 });

    const body = await req.json().catch(() => ({}));
    const fileUrl = body.file_url;
    const userPrompt = body.prompt || "";
    if (!fileUrl) return Response.json({ error: "file_url is required" }, { status: 400 });

    const ocrRes = await fetch(OCR, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "mistral-ocr-latest", document: { type: "document_url", document_url: fileUrl } }),
    });
    if (!ocrRes.ok) return Response.json({ error: "OCR failed", detail: await ocrRes.text() }, { status: 502 });
    const ocr = await ocrRes.json();
    const pages = ocr.pages || [];
    const ocrText = pages.map((p, i) => `----- PAGE ${i + 1} -----\n${p.markdown || ""}`).join("\n\n");

    const instructions = (userPrompt ? userPrompt + "\n\n" : "") +
      `You are given OCR TEXT (Markdown, page by page) of a document with MANY separate till receipts. ` +
      `Extract EVERY distinct receipt across ALL pages — never skip or merge. Return ONLY JSON: ` +
      `{ "receipts": [ { "vendor_name": string, "receipt_date": "YYYY-MM-DD", "country": string, "currency": string, ` +
      `"total_amount": number, "vat_amount": number, "vat_rate": number, "vat_explicit": boolean, "is_tax_free": boolean, ` +
      `"ocr_text": string, "extraction_notes": string, "confidence_score": number, "receipt_location": string } ] }.\n\nOCR TEXT:\n` + ocrText;

    const chatRes = await fetch(CHAT, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "mistral-large-latest", temperature: 0, response_format: { type: "json_object" }, messages: [{ role: "user", content: instructions }] }),
    });
    if (!chatRes.ok) return Response.json({ error: "Structuring failed", detail: await chatRes.text() }, { status: 502 });
    const chat = await chatRes.json();
    let parsed = {};
    try { parsed = JSON.parse(chat?.choices?.[0]?.message?.content || "{}"); } catch { parsed = { receipts: [] }; }
    return Response.json({ receipts: Array.isArray(parsed.receipts) ? parsed.receipts : [], ocr_pages: pages.length });
  } catch (e) {
    return Response.json({ error: String(e?.message || e) }, { status: 500 });
  }
});
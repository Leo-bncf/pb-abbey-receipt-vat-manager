// Base44 backend function (Deno). Reads a receipt PDF/image with Mistral OCR
// (all pages, no page cap), then structures the text into receipts JSON with a
// Mistral chat model. Uses the MISTRAL_API_KEY secret — never exposed to the
// frontend. Invoke from the app with:
//   base44.functions.invoke('extractReceiptsMistral', { file_url, prompt })
//
// Returns: { receipts: [...], ocr_pages: number } or { error, detail }.

const MISTRAL_OCR_URL = "https://api.mistral.ai/v1/ocr/process";
const MISTRAL_CHAT_URL = "https://api.mistral.ai/v1/chat/completions";

Deno.serve(async (req: Request) => {
  try {
    if (req.method !== "POST") {
      return Response.json({ error: "Use POST" }, { status: 405 });
    }

    const apiKey = Deno.env.get("MISTRAL_API_KEY");
    if (!apiKey) {
      return Response.json({ error: "MISTRAL_API_KEY secret is not set" }, { status: 500 });
    }

    const body = await req.json().catch(() => ({}));
    const fileUrl: string | undefined = body.file_url;
    const userPrompt: string = body.prompt || "";
    if (!fileUrl) {
      return Response.json({ error: "file_url is required" }, { status: 400 });
    }

    // 1) OCR every page of the document (no page limit, unlike annotations).
    const ocrRes = await fetch(MISTRAL_OCR_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "mistral-ocr-latest",
        document: { type: "document_url", document_url: fileUrl },
      }),
    });
    if (!ocrRes.ok) {
      const detail = await ocrRes.text();
      return Response.json({ error: "Mistral OCR failed", status: ocrRes.status, detail }, { status: 502 });
    }
    const ocr = await ocrRes.json();
    const pages: any[] = ocr.pages || [];
    const ocrText = pages
      .map((p, i) => `----- PAGE ${i + 1} -----\n${p.markdown || ""}`)
      .join("\n\n");

    // 2) Structure the OCR text into a receipts array with a chat model.
    const instructions =
      (userPrompt ? userPrompt + "\n\n" : "") +
      `You are given the OCR TEXT (Markdown, page by page) of a document that may ` +
      `contain MANY separate till receipts / tickets. Extract EVERY distinct receipt ` +
      `across ALL pages — do not skip any, and do not merge two receipts into one. ` +
      `Return ONLY JSON of the exact shape: ` +
      `{ "receipts": [ { "vendor_name": string, "receipt_date": "YYYY-MM-DD", ` +
      `"country": string, "currency": string, "total_amount": number, "vat_amount": number, ` +
      `"vat_rate": number, "vat_explicit": boolean, "is_tax_free": boolean, ` +
      `"ocr_text": string, "extraction_notes": string, "confidence_score": number, ` +
      `"receipt_location": string } ] }. ` +
      `receipt_location should say which page the receipt is on (e.g. "page 3").\n\n` +
      `OCR TEXT:\n${ocrText}`;

    const chatRes = await fetch(MISTRAL_CHAT_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "mistral-large-latest",
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [{ role: "user", content: instructions }],
      }),
    });
    if (!chatRes.ok) {
      const detail = await chatRes.text();
      return Response.json({ error: "Mistral structuring failed", status: chatRes.status, detail }, { status: 502 });
    }
    const chat = await chatRes.json();
    const content = chat?.choices?.[0]?.message?.content || "{}";
    let parsed: any = {};
    try {
      parsed = JSON.parse(content);
    } catch {
      parsed = { receipts: [] };
    }

    return Response.json({
      receipts: Array.isArray(parsed.receipts) ? parsed.receipts : [],
      ocr_pages: pages.length,
    });
  } catch (e) {
    return Response.json({ error: String((e as Error)?.message || e) }, { status: 500 });
  }
});

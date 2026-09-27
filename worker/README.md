# Mistral receipt-extraction Worker

A Cloudflare Worker that reads a receipt PDF/image with **Mistral OCR** and
structures each page into receipts JSON. Your Mistral key stays server-side as
a Worker secret. This replaces the base44 backend function (base44 is no longer
in the AI path).

## Deploy (once, ~5 min)

From this `worker/` folder:

```bash
# 1. Log in to your Cloudflare account
npx wrangler login

# 2. Store your Mistral API key as a secret (paste it when prompted)
npx wrangler secret put MISTRAL_API_KEY

# 3. Deploy
npx wrangler deploy
```

`wrangler deploy` prints the Worker URL, e.g.
`https://pb-abbey-mistral.<your-subdomain>.workers.dev`.

**Send me that URL** — I wire the frontend to call it.

## Notes
- CORS is locked to `https://pb-abbey-receipts.base44.app` (edit `ALLOW_ORIGIN`
  in `src/index.js` if the app domain changes).
- To rotate the key later: `npx wrangler secret put MISTRAL_API_KEY` again.
- Free tier is plenty (one document ≈ 1 + N-pages subrequests, well under limits).

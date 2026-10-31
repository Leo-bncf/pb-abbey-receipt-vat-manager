// PB Abbey · mail — public, JWT-gated entry point for the IONOS mailbox view.
//
// The actual IMAP work runs in the `mail-imap` Node sidecar (OpenSSL TLS 1.2,
// which the IONOS Exchange server requires — Deno/rustls only offers TLS 1.3,
// which exchange.ionos.com rejects). This function handles CORS + auth and
// proxies to the sidecar on the internal docker network.
//
// Stack runs VERIFY_JWT=false, so data actions verify the Supabase access token
// here (HS256, role=authenticated). ping/selftest/logintest are open diagnostics.
import * as jose from 'jsr:@panva/jose@6'

const JWT_SECRET = Deno.env.get('JWT_SECRET') ?? ''
const SIDECAR = Deno.env.get('MAIL_SIDECAR_URL') ?? 'http://mail-imap:8799'
const OPEN_ACTIONS = new Set(['ping', 'selftest', 'logintest'])

const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })

async function requireUser(req: Request): Promise<boolean> {
  const token = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '').trim()
  if (!token || !JWT_SECRET) return false
  try {
    const { payload } = await jose.jwtVerify(token, new TextEncoder().encode(JWT_SECRET))
    return payload.role === 'authenticated'
  } catch {
    return false
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  const url = new URL(req.url)
  const action = url.searchParams.get('action') || 'list'

  if (!OPEN_ACTIONS.has(action)) {
    if (!(await requireUser(req))) return json({ error: 'unauthorized' }, 401)
  }

  try {
    const init: RequestInit = { method: req.method }
    if (req.method === 'POST') { init.body = await req.text(); init.headers = { 'Content-Type': 'application/json' } }
    const r = await fetch(SIDECAR + '/' + url.search, init)
    const headers = new Headers(CORS)
    headers.set('Content-Type', r.headers.get('content-type') || 'application/json')
    const cd = r.headers.get('content-disposition')
    if (cd) headers.set('Content-Disposition', cd)
    return new Response(await r.arrayBuffer(), { status: r.status, headers })
  } catch (e) {
    return json({ error: 'mail service unreachable: ' + String(e) }, 502)
  }
})

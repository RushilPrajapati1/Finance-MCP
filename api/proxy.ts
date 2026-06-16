// Server-side proxy (Backend-for-Frontend) for the FinLedger API.
//
// Every /api/* request is routed here by the rewrite in vercel.json
// (/api/:path* -> /api/proxy?path=:path*), so a SINGLE function handles every
// path regardless of depth — avoiding the catch-all routing quirk with
// [...path] functions on non-Next projects.
//
// The browser calls /api/* with NO credentials. This function runs on Vercel's
// edge runtime, injects the tenant API key from a SERVER-ONLY env var
// (FINLEDGER_API_KEY — never a VITE_ var, so it is never bundled into the
// client), and forwards to the Render backend. That keeps the key off the
// browser entirely. The backend still requires X-API-Key — that is its security
// boundary and is unchanged; we just supply the key here instead of in the UI.
//
// Required Vercel env vars (Project → Settings → Environment Variables):
//   FINLEDGER_API_KEY   the tenant key (sk_live_...)   [secret, Production + Preview]
//   FINLEDGER_API_URL   backend base URL (optional; default below)

export const config = { runtime: 'edge' }

const UPSTREAM = (process.env.FINLEDGER_API_URL ?? 'https://finledger-api-rw1f.onrender.com').replace(/\/$/, '')
const API_KEY = process.env.FINLEDGER_API_KEY ?? ''

export default async function handler(req: Request): Promise<Response> {
  if (!API_KEY) {
    return errorJson(500, 'gateway_misconfigured', 'FINLEDGER_API_KEY is not set on the server.')
  }

  const url = new URL(req.url)
  // The rewrite passes the real ledger path in the `path` query param; the rest
  // of the query string (e.g. ?limit=500) is forwarded unchanged.
  const path = (url.searchParams.get('path') ?? '').replace(/^\/+/, '')
  url.searchParams.delete('path')
  const qs = url.searchParams.toString()
  const target = `${UPSTREAM}/${path}${qs ? `?${qs}` : ''}`

  const headers = new Headers(req.headers)
  // The browser must never supply credentials; the server owns the only key.
  headers.delete('x-api-key')
  headers.delete('authorization')
  headers.delete('cookie')
  headers.delete('host')
  // Force identity encoding so the upstream body streams back verbatim.
  headers.delete('accept-encoding')
  headers.set('X-API-Key', API_KEY)

  const hasBody = req.method !== 'GET' && req.method !== 'HEAD'

  let upstream: Response
  try {
    upstream = await fetch(target, {
      method: req.method,
      headers,
      body: hasBody ? await req.arrayBuffer() : undefined,
    })
  } catch {
    return errorJson(502, 'upstream_unavailable', 'The ledger backend is unreachable.')
  }

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: upstream.headers,
  })
}

// Match the ledger's error envelope so the client handles these identically.
function errorJson(status: number, code: string, message: string): Response {
  return new Response(JSON.stringify({ error: { code, message } }), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

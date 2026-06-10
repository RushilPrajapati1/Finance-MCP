// Thin typed wrapper over the FinLedger HTTP API.
//
// All requests go to `${baseUrl}` which defaults to "/api" — the Vite dev proxy
// forwards that to the backend (see vite.config.ts), so the browser stays
// same-origin and never trips the backend's missing CORS headers.

import type {
  Account,
  AccountCreate,
  Balance,
  Health,
  Integrity,
  ReversalCreate,
  Transaction,
  TransactionCreate,
  TrialBalance,
} from './types'

const API_KEY_STORAGE = 'finledger.apiKey'
const BASE_URL_STORAGE = 'finledger.baseUrl'
const DEFAULT_BASE_URL = '/api'

// 👉 PUT YOUR API KEY HERE: web/.env.local  →  VITE_FINLEDGER_API_KEY=sk_live_...
// Optional local-dev convenience: a key set in web/.env.local as
// VITE_FINLEDGER_API_KEY is used as the default when nothing is saved in this
// browser. localStorage (the Settings screen) always takes precedence, so you
// can still override or rotate the key in the UI without touching the file.
//
// Dev-only on purpose: in a production build Vite would inline the key as a
// plain string in the public JS bundle, leaking it to every visitor. So we
// only read it under `import.meta.env.DEV`; production users enter their key
// in Settings (localStorage).
const ENV_API_KEY = import.meta.env.DEV
  ? (import.meta.env.VITE_FINLEDGER_API_KEY ?? '').trim()
  : ''

export class ApiError extends Error {
  code: string
  status: number
  constructor(code: string, message: string, status: number) {
    super(message)
    this.name = 'ApiError'
    this.code = code
    this.status = status
  }
}

export function getApiKey(): string {
  return localStorage.getItem(API_KEY_STORAGE) ?? ENV_API_KEY
}

export function setApiKey(key: string): void {
  if (key) localStorage.setItem(API_KEY_STORAGE, key)
  else localStorage.removeItem(API_KEY_STORAGE)
}

export function getBaseUrl(): string {
  return localStorage.getItem(BASE_URL_STORAGE) ?? DEFAULT_BASE_URL
}

export function setBaseUrl(url: string): void {
  if (url && url !== DEFAULT_BASE_URL) localStorage.setItem(BASE_URL_STORAGE, url)
  else localStorage.removeItem(BASE_URL_STORAGE)
}

export function hasApiKey(): boolean {
  return getApiKey().trim().length > 0
}

/** Stable client-side idempotency key for transaction POSTs. */
export function newIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID()
  }
  return `idem-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

async function request<T>(
  path: string,
  options: { method?: string; body?: unknown; auth?: boolean } = {},
): Promise<T> {
  const { method = 'GET', body, auth = true } = options
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  if (auth) {
    const key = getApiKey()
    if (!key) throw new ApiError('no_api_key', 'No API key configured.', 0)
    headers['X-API-Key'] = key
  }

  let res: Response
  try {
    res = await fetch(`${getBaseUrl()}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
  } catch {
    throw new ApiError(
      'network_error',
      'Could not reach the ledger. Is the backend running on :8000?',
      0,
    )
  }

  if (res.status === 204) return undefined as T

  let payload: unknown = null
  const text = await res.text()
  if (text) {
    try {
      payload = JSON.parse(text)
    } catch {
      payload = text
    }
  }

  if (!res.ok) {
    const err = (payload as { error?: { code?: string; message?: string } })?.error
    throw new ApiError(
      err?.code ?? 'http_error',
      err?.message ?? `Request failed (${res.status}).`,
      res.status,
    )
  }
  return payload as T
}

export const api = {
  // health (no /v1 prefix, no auth)
  health: () => request<Health>('/health', { auth: false }),

  // accounts
  listAccounts: () => request<Account[]>('/v1/accounts?limit=500'),
  getAccount: (id: string) => request<Account>(`/v1/accounts/${id}`),
  createAccount: (body: AccountCreate) =>
    request<Account>('/v1/accounts', { method: 'POST', body }),
  getBalance: (id: string) => request<Balance>(`/v1/accounts/${id}/balance`),

  // transactions
  listTransactions: (limit = 100) =>
    request<Transaction[]>(`/v1/transactions?limit=${limit}`),
  getTransaction: (id: string) => request<Transaction>(`/v1/transactions/${id}`),
  createTransaction: (body: TransactionCreate) =>
    request<Transaction>('/v1/transactions', { method: 'POST', body }),
  reverseTransaction: (id: string, body: ReversalCreate) =>
    request<Transaction>(`/v1/transactions/${id}/reversal`, {
      method: 'POST',
      body,
    }),

  // ledger
  trialBalance: () => request<TrialBalance>('/v1/ledger/trial-balance'),
  verify: () => request<Integrity>('/v1/ledger/verify'),
}

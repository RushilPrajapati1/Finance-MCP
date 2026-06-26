// Types mirroring the FinLedger HTTP contract (app/api/schemas.py).
// Money fields are ALWAYS strings — never coerce them to `number`.

export type AccountType =
  | 'asset'
  | 'liability'
  | 'equity'
  | 'revenue'
  | 'expense'

export type Direction = 'debit' | 'credit'

export interface Account {
  id: string
  name: string
  type: AccountType
  currency: string
  external_id: string | null
  is_active: boolean
  metadata: Record<string, unknown> | null
  created_at: string
}

export interface AccountCreate {
  name: string
  type: AccountType
  currency: string
  external_id?: string | null
  metadata?: Record<string, unknown> | null
}

export interface Posting {
  id: string
  account_id: string
  direction: Direction
  amount: string
  currency: string
}

export interface PostingInput {
  account_id: string
  direction: Direction
  amount: string
  currency?: string | null
}

export interface Transaction {
  id: string
  description: string | null
  idempotency_key: string | null
  external_id: string | null
  reverses_transaction_id: string | null
  metadata: Record<string, unknown> | null
  postings: Posting[]
  posted_at: string
  created_at: string
}

export interface TransactionCreate {
  postings: PostingInput[]
  description?: string | null
  idempotency_key?: string | null
  external_id?: string | null
  metadata?: Record<string, unknown> | null
}

export interface ReversalCreate {
  description?: string | null
  idempotency_key?: string | null
}

export interface Balance {
  account_id: string
  currency: string
  normal_balance: Direction
  debits: string
  credits: string
  balance: string
}

export interface CurrencyTotals {
  currency: string
  debits: string
  credits: string
  difference: string
  balanced: boolean
}

export interface TrialBalance {
  balanced: boolean
  currencies: CurrencyTotals[]
}

export interface Integrity {
  consistent: boolean
  discrepancies: Array<Record<string, unknown>>
}

export interface Health {
  status: string
  service: string
  environment: string
}

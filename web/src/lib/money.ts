// Decimal money helpers. The ledger speaks in exact decimal strings, so we do
// all arithmetic on BigInt-scaled integers and never touch JS floats.

import type { AccountType, Direction } from '../api/types'

// Mirrors app/ledger_ddl.py DEFAULT_CURRENCIES — code -> exponent (decimals).
export const CURRENCIES: Record<string, { exponent: number; name: string }> = {
  USD: { exponent: 2, name: 'US Dollar' },
  EUR: { exponent: 2, name: 'Euro' },
  GBP: { exponent: 2, name: 'Pound Sterling' },
  JPY: { exponent: 0, name: 'Japanese Yen' },
  INR: { exponent: 2, name: 'Indian Rupee' },
  CHF: { exponent: 2, name: 'Swiss Franc' },
  CAD: { exponent: 2, name: 'Canadian Dollar' },
  AUD: { exponent: 2, name: 'Australian Dollar' },
  SGD: { exponent: 2, name: 'Singapore Dollar' },
  BTC: { exponent: 8, name: 'Bitcoin' },
  ETH: { exponent: 18, name: 'Ether' },
  USDC: { exponent: 6, name: 'USD Coin' },
}

export const CURRENCY_CODES = Object.keys(CURRENCIES)

export function currencyExponent(code: string): number {
  return CURRENCIES[code]?.exponent ?? 2
}

function fracLen(value: string): number {
  const i = value.indexOf('.')
  return i === -1 ? 0 : value.length - i - 1
}

// Scale a decimal string to an integer BigInt at `scale` decimal places.
function toScaled(value: string, scale: number): bigint {
  const trimmed = value.trim()
  const neg = trimmed.startsWith('-')
  const v = neg ? trimmed.slice(1) : trimmed
  const [intPart, fracPart = ''] = v.split('.')
  const frac = (fracPart + '0'.repeat(scale)).slice(0, scale)
  const digits = (intPart || '0') + frac
  const n = BigInt(digits.replace(/^0+(?=\d)/, ''))
  return neg ? -n : n
}

function fromScaled(n: bigint, scale: number): string {
  const neg = n < 0n
  const abs = (neg ? -n : n).toString().padStart(scale + 1, '0')
  const intPart = abs.slice(0, abs.length - scale)
  const frac = scale > 0 ? '.' + abs.slice(abs.length - scale) : ''
  return (neg ? '-' : '') + intPart + frac
}

export function addDecimal(a: string, b: string): string {
  const scale = Math.max(fracLen(a), fracLen(b))
  return fromScaled(toScaled(a, scale) + toScaled(b, scale), scale)
}

export function subtractDecimal(a: string, b: string): string {
  const scale = Math.max(fracLen(a), fracLen(b))
  return fromScaled(toScaled(a, scale) - toScaled(b, scale), scale)
}

export function compareDecimal(a: string, b: string): number {
  const scale = Math.max(fracLen(a), fracLen(b))
  const da = toScaled(a, scale)
  const db = toScaled(b, scale)
  return da < db ? -1 : da > db ? 1 : 0
}

export function isZero(a: string): boolean {
  return compareDecimal(a, '0') === 0
}

export function negate(a: string): string {
  return a.startsWith('-') ? a.slice(1) : a === '0' || isZero(a) ? a : '-' + a
}

/** True if the string is a valid positive decimal amount (what the API wants). */
export function isValidPositiveAmount(value: string): boolean {
  if (!/^\d+(\.\d+)?$/.test(value.trim())) return false
  return compareDecimal(value, '0') > 0
}

/** Format an amount for display: thousands separators + currency-correct decimals. */
export function formatMoney(amount: string, currency: string): string {
  const exp = currencyExponent(currency)
  const scaled = fromScaled(toScaled(amount, exp), exp)
  const neg = scaled.startsWith('-')
  const body = neg ? scaled.slice(1) : scaled
  const [intPart, fracPart] = body.split('.')
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  const out = fracPart ? `${grouped}.${fracPart}` : grouped
  return `${neg ? '-' : ''}${out} ${currency}`
}

// --- Accounting helpers (mirror app/domain/enums.py) ---------------------- //

const DEBIT_NORMAL: AccountType[] = ['asset', 'expense']

export function normalBalance(type: AccountType): Direction {
  return DEBIT_NORMAL.includes(type) ? 'debit' : 'credit'
}

export const ACCOUNT_TYPES: AccountType[] = [
  'asset',
  'liability',
  'equity',
  'revenue',
  'expense',
]

import type { ReactNode } from 'react'
import type { AccountType, Direction } from '../api/types'

export function Spinner() {
  return <div className="spinner" />
}

export function ErrorBanner({ message }: { message: string | null }) {
  if (!message) return null
  return <div className="banner error">{message}</div>
}

export function Badge({
  kind,
  children,
}: {
  kind: AccountType | Direction | 'ok' | 'bad' | 'muted'
  children: ReactNode
}) {
  return <span className={`badge ${kind}`}>{children}</span>
}

export function Stat({
  title,
  value,
  sub,
  tone,
}: {
  title: string
  value: ReactNode
  sub?: ReactNode
  tone?: 'pos' | 'neg'
}) {
  return (
    <div className="card stat">
      <div className="card-title">{title}</div>
      <div className={`value ${tone ?? ''}`}>{value}</div>
      {sub != null && <div className="sub">{sub}</div>}
    </div>
  )
}

export function Modal({
  title,
  onClose,
  children,
}: {
  title: string
  onClose: () => void
  children: ReactNode
}) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>{title}</h2>
        {children}
      </div>
    </div>
  )
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>
}

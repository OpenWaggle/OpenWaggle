import { AlertCircle, CheckCircle2, XCircle } from 'lucide-react'

export function StatusBadge({ status }: { status: 'found' | 'missing' | 'error' }) {
  if (status === 'found') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-success/30 bg-success/10 px-2 py-0.5 text-xs text-success">
        <CheckCircle2 className="size-3" />
        Found
      </span>
    )
  }
  if (status === 'error') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-error/30 bg-error/10 px-2 py-0.5 text-xs text-error">
        <XCircle className="size-3" />
        Error
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-xs text-text-tertiary">
      <AlertCircle className="size-3" />
      Missing
    </span>
  )
}

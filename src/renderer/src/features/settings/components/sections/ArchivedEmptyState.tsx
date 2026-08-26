import { Archive } from 'lucide-react'

export function ArchivedEmptyState() {
  return (
    <div className="flex flex-col items-center gap-3 py-20 text-center">
      <Archive className="size-6 text-text-muted/60" />
      <p className="text-xs text-text-muted">No archived sessions or branches</p>
    </div>
  )
}

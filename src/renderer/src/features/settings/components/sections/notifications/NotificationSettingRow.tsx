import type { ReactNode } from 'react'

/** One Settings → Notifications row: its label and description, then its controls. */
export function Row({
  label,
  description,
  children,
}: {
  readonly label: string
  readonly description?: string
  readonly children: ReactNode
}) {
  return (
    <div className="flex min-h-14 items-center justify-between gap-4 border-b border-border px-5 py-3 last:border-b-0">
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="text-xs font-medium text-text-primary">{label}</span>
        {description ? <span className="text-xs text-text-tertiary">{description}</span> : null}
      </div>
      <div className="flex shrink-0 items-center gap-2">{children}</div>
    </div>
  )
}

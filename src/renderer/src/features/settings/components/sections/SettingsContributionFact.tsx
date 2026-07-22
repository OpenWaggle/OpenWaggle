import type { ReactNode } from 'react'

export function SettingsContributionFact({
  label,
  children,
}: {
  readonly label: string
  readonly children: ReactNode
}) {
  return (
    <div className="min-w-0">
      <div className="text-[11px] text-text-muted">{label}</div>
      <div className="truncate text-[12px] text-text-secondary">{children}</div>
    </div>
  )
}

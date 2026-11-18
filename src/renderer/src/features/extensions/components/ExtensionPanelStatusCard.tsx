import type { ReactNode } from 'react'

/** A compact status notice inside an extension side panel or dialog, announced as an alert. */
export function ExtensionPanelStatusCard({
  icon,
  title,
  message,
  action,
}: {
  readonly icon: ReactNode
  readonly title: string
  readonly message: string
  readonly action?: ReactNode
}) {
  return (
    <section role="alert" className="rounded-xl border border-border bg-bg-secondary p-4">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 text-accent">{icon}</div>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold text-text-primary">{title}</h3>
          <p className="mt-1 text-xs leading-5 text-text-tertiary">{message}</p>
          {action ? <div className="mt-3">{action}</div> : null}
        </div>
      </div>
    </section>
  )
}

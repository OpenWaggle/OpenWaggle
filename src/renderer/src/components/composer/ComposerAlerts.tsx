import { X } from 'lucide-react'

interface ComposerAlert {
  id: string
  message: string
  onDismiss?: () => void
}

interface ComposerAlertsProps {
  alerts: readonly ComposerAlert[]
}

export function ComposerAlerts({ alerts }: ComposerAlertsProps): React.JSX.Element | null {
  if (alerts.length === 0) return null

  return (
    <div className="mb-2 rounded-md border border-border bg-bg px-2.5 py-1.5 text-[12px] text-text-secondary">
      {alerts.map((alert) => (
        <div key={alert.id} className="flex items-start justify-between gap-2">
          <div>{alert.message}</div>
          {alert.onDismiss ? (
            <button
              type="button"
              onClick={alert.onDismiss}
              className="mt-px shrink-0 rounded-sm p-0.5 text-text-tertiary transition-colors hover:text-text-primary"
              aria-label={`Dismiss message: ${alert.message}`}
              title="Dismiss message"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          ) : null}
        </div>
      ))}
    </div>
  )
}

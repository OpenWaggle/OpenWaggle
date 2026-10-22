import { ToggleSwitch } from '@/shared/ui/ToggleSwitch'
import { useBackgroundStart } from '../hooks/useBackgroundStart'

const LABEL = 'Background start'

/** Settings row: start only the Session Host at login, so Scheduled tasks survive a restart. */
export function BackgroundStartSetting() {
  const backgroundStart = useBackgroundStart()
  const status = backgroundStart.status
  const unsupported = status !== null && !status.supported
  const detail = backgroundStart.error ?? (unsupported ? status.reason : null)

  return (
    <div className="space-y-3">
      <h3 className="text-base font-semibold text-text-primary">Session Host</h3>
      <div className="flex min-h-14 items-center justify-between gap-4 rounded-lg border border-border bg-bg px-5 py-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="text-xs font-medium text-text-primary">{LABEL}</span>
          <span className="text-xs text-text-tertiary">
            Start the Session Host at login so Scheduled tasks keep running after a restart. It
            opens no window.
          </span>
          {detail ? <span className="text-xs text-text-muted">{detail}</span> : null}
        </div>
        <ToggleSwitch
          checked={status?.enabled ?? false}
          label={LABEL}
          disabled={status === null || unsupported || backgroundStart.isSaving}
          onCheckedChange={(enabled) => backgroundStart.setEnabled(enabled)}
        />
      </div>
    </div>
  )
}

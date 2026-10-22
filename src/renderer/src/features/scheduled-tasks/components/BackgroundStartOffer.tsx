import { useQuery } from '@tanstack/react-query'
import { Power, X } from 'lucide-react'
import { scheduledTasksListQueryOptions } from '@/queries/scheduled-tasks'
import { Button } from '@/shared/ui/Button'
import { useBackgroundStart } from '../hooks/useBackgroundStart'
import { useScheduledTasksPreferencesStore } from '../state/scheduled-tasks-preferences-store'

/**
 * Offered once, after the first Scheduled task exists, while Background start is supported and
 * off (ADR 0057). Turning it on or dismissing it both retire the offer for good.
 */
export function BackgroundStartOffer() {
  const dismissed = useScheduledTasksPreferencesStore(
    (state) => state.backgroundStartOfferDismissed,
  )
  const dismiss = useScheduledTasksPreferencesStore((state) => state.dismissBackgroundStartOffer)
  const tasks = useQuery(scheduledTasksListQueryOptions())
  const backgroundStart = useBackgroundStart()
  const status = backgroundStart.status
  const hasTasks = (tasks.data?.length ?? 0) > 0

  if (dismissed || !hasTasks || !status?.supported || status.enabled) return null

  return (
    <output className="flex items-start gap-3 rounded-lg border border-accent/30 bg-accent/5 px-4 py-3">
      <Power aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-accent" />
      <div className="min-w-0 flex-1 text-xs">
        <p className="font-medium text-text-primary">
          Keep Scheduled tasks running after a restart
        </p>
        <p className="mt-0.5 text-text-tertiary">
          Turn on Background start to start the Session Host, with no window, when you log in.
          Nothing runs while the machine is asleep.
        </p>
        {backgroundStart.error ? (
          <p className="mt-1 text-error-text">{backgroundStart.error}</p>
        ) : null}
      </div>
      <Button
        variant="accent"
        size="xs"
        disabled={backgroundStart.isSaving}
        onClick={() => backgroundStart.setEnabled(true, dismiss)}
      >
        Turn on
      </Button>
      <Button variant="ghost" size="icon-sm" aria-label="Dismiss" onClick={dismiss}>
        <X className="size-3.5" />
      </Button>
    </output>
  )
}

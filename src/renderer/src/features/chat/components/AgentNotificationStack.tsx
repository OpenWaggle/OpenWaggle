import type {
  AgentLoopNotifyInteraction,
  AgentLoopNotifyLevel,
} from '@shared/types/agent-loop-interaction'
import type { AgentTransportInteractionRequestEvent } from '@shared/types/stream'
import { AlertTriangle, Bell, Info, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { cn } from '@/shared/lib/cn'
import { Button } from '@/shared/ui/Button'
import type { AgentInteractionEvent } from '../lib/types-chat-row'

const INFO_DISMISS_DELAY_MS = 3200
const MAX_VISIBLE_NOTIFICATIONS = 3

type NotifyRequestEvent = AgentTransportInteractionRequestEvent & {
  readonly interaction: AgentLoopNotifyInteraction
}

function isNotifyRequest(event: AgentInteractionEvent): event is NotifyRequestEvent {
  return event.type === 'agent_interaction_request' && event.interaction.kind === 'notify'
}

function notificationToneClasses(level: AgentLoopNotifyLevel) {
  if (level === 'error') {
    return {
      icon: 'text-error',
      surface: 'border-error/30 bg-error/10',
      pulse: 'bg-error',
    }
  }

  if (level === 'warning') {
    return {
      icon: 'text-warning',
      surface: 'border-warning/30 bg-warning/10',
      pulse: 'bg-warning',
    }
  }

  return {
    icon: 'text-accent',
    surface: 'border-accent/25 bg-bg-secondary/95',
    pulse: 'bg-accent',
  }
}

function notificationIcon(level: AgentLoopNotifyLevel) {
  if (level === 'error') {
    return AlertTriangle
  }

  if (level === 'warning') {
    return Bell
  }

  return Info
}

function notificationLabel(level: AgentLoopNotifyLevel) {
  if (level === 'error') {
    return 'Error'
  }

  if (level === 'warning') {
    return 'Warning'
  }

  return 'Notification'
}

function visibleNotifications(
  events: readonly AgentInteractionEvent[],
  dismissedIds: ReadonlySet<string>,
) {
  const byId = new Map<string, NotifyRequestEvent>()

  for (const event of events) {
    if (!isNotifyRequest(event)) {
      continue
    }

    const id = event.interaction.interactionId
    if (!dismissedIds.has(id)) {
      byId.set(id, event)
    }
  }

  return [...byId.values()]
    .sort((left, right) => right.timestamp - left.timestamp)
    .slice(0, MAX_VISIBLE_NOTIFICATIONS)
    .reverse()
}

export function AgentNotificationStack({
  events,
}: {
  readonly events: readonly AgentInteractionEvent[]
}) {
  const [dismissedIds, setDismissedIds] = useState<ReadonlySet<string>>(() => new Set())
  const notifications = useMemo(
    () => visibleNotifications(events, dismissedIds),
    [events, dismissedIds],
  )

  useEffect(() => {
    const timers = notifications
      .filter((event) => event.interaction.level === 'info')
      .map((event) =>
        window.setTimeout(() => {
          setDismissedIds((current) => new Set(current).add(event.interaction.interactionId))
        }, INFO_DISMISS_DELAY_MS),
      )

    return () => {
      for (const timer of timers) {
        window.clearTimeout(timer)
      }
    }
  }, [notifications])

  if (notifications.length === 0) {
    return null
  }

  return (
    <div className="mb-2 grid gap-2">
      {notifications.map((event) => {
        const { interaction } = event
        const tone = notificationToneClasses(interaction.level)
        const Icon = notificationIcon(interaction.level)
        return (
          <section
            className={cn(
              'overflow-hidden rounded-2xl border shadow-[0_18px_60px_-42px_rgb(0_0_0/0.95)] backdrop-blur',
              tone.surface,
            )}
            key={interaction.interactionId}
          >
            <div className="flex items-start gap-3 p-3">
              <span className={cn('mt-2 size-1.5 shrink-0 rounded-full', tone.pulse)} />
              <Icon className={cn('mt-0.5 size-4 shrink-0', tone.icon)} />
              <div className="min-w-0 flex-1">
                <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-text-muted">
                  {notificationLabel(interaction.level)}
                </p>
                <p className="mt-1 text-[12px] leading-5 text-text-secondary">
                  {interaction.message}
                </p>
              </div>
              <Button
                aria-label="Dismiss notification"
                className="-mr-1 -mt-1"
                onClick={() =>
                  setDismissedIds((current) => new Set(current).add(interaction.interactionId))
                }
                size="icon-xs"
                variant="ghost"
              >
                <X className="size-3" />
              </Button>
            </div>
          </section>
        )
      })}
    </div>
  )
}

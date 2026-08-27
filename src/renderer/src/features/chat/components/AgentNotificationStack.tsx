import type {
  AgentLoopNotifyInteraction,
  AgentLoopNotifyLevel,
} from '@shared/types/agent-loop-interaction'
import type { AgentTransportInteractionRequestEvent } from '@shared/types/stream'
import { CircleAlert, Info, TriangleAlert, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { cn } from '@/shared/lib/cn'
import { Button } from '@/shared/ui/Button'
import { notificationLifetimeMs, orderNotifications } from '../lib/notification-stack-model'
import type { AgentInteractionEvent } from '../lib/types-chat-row'
import { useChatDisplayText } from './ChatDisplayPathContext'
import { PoliteAnnouncer } from './PoliteAnnouncer'

const MAX_VISIBLE_NOTIFICATIONS = 3
const DISMISS_ICON_STROKE_WIDTH = 2.25
const PEEK_STEP_PX = 12
const SCALE_STEP = 0.1

type NotifyRequestEvent = AgentTransportInteractionRequestEvent & {
  readonly interaction: AgentLoopNotifyInteraction
}

function isNotifyRequest(event: AgentInteractionEvent): event is NotifyRequestEvent {
  return event.type === 'agent_interaction_request' && event.interaction.kind === 'notify'
}

interface VisibleNotification {
  readonly id: string
  readonly level: AgentLoopNotifyLevel
  readonly message: string
  readonly timestamp: number
}

function toVisibleNotifications(
  events: readonly AgentInteractionEvent[],
  dismissedIds: ReadonlySet<string>,
): readonly VisibleNotification[] {
  const byId = new Map<string, VisibleNotification>()

  for (const event of events) {
    if (!isNotifyRequest(event)) continue

    const id = event.interaction.interactionId
    if (dismissedIds.has(id)) continue

    byId.set(id, {
      id,
      level: event.interaction.level,
      message: event.interaction.message,
      timestamp: event.timestamp,
    })
  }

  return orderNotifications([...byId.values()])
}

function notificationTone(level: AgentLoopNotifyLevel) {
  if (level === 'error') return { icon: 'text-error', border: 'border-error/40 bg-error/12' }
  if (level === 'warning')
    return { icon: 'text-warning', border: 'border-warning/30 bg-warning/10' }
  return { icon: 'text-info', border: 'border-border/60 bg-bg-secondary/92' }
}

function notificationIcon(level: AgentLoopNotifyLevel) {
  if (level === 'error') return CircleAlert
  if (level === 'warning') return TriangleAlert
  return Info
}

function notificationLabel(level: AgentLoopNotifyLevel) {
  if (level === 'error') return 'Error notification'
  if (level === 'warning') return 'Warning notification'
  return 'Notification'
}

/**
 * Runs one notice's dismissal clock, counting only focused time.
 *
 * Mounted per notice id and rendering nothing, which is how T3 Code does it
 * (`ui/toast.tsx:455`). Two reasons it matters. Keying the timer to the notice rather than to the
 * array means a newly arriving notice cannot restart everyone else's clock, which previously kept
 * informational notices on screen indefinitely during a busy run. Pausing on blur means a notice
 * cannot expire while the user is looking at another window, so nothing is missed silently.
 *
 * Mounted for every notice including ones queued behind the visible slots, so a hidden notice ages
 * out instead of appearing later once the visible ones go.
 *
 * `paused` covers pointer hover: hovering is the strongest available signal that a notice is being
 * read, and letting one expire under the pointer as the user reaches for Dismiss contradicts the
 * rule that a notice cannot expire unwatched. There is no history to recover it from.
 */
function NotificationDismissClock({
  id,
  level,
  paused,
  onExpire,
}: {
  readonly id: string
  readonly level: AgentLoopNotifyLevel
  readonly paused: boolean
  readonly onExpire: (id: string) => void
}) {
  useEffect(() => {
    const lifetime = notificationLifetimeMs(level)
    if (lifetime === null) return

    let remaining = lifetime
    let startedAt: number | null = null
    let timer: number | null = null

    const clear = () => {
      if (timer === null) return
      window.clearTimeout(timer)
      timer = null
    }

    const pause = () => {
      if (startedAt === null) return
      remaining = Math.max(0, remaining - (Date.now() - startedAt))
      startedAt = null
      clear()
    }

    const start = () => {
      if (startedAt !== null) return
      startedAt = Date.now()
      clear()
      timer = window.setTimeout(() => {
        startedAt = null
        onExpire(id)
      }, remaining)
    }

    const sync = () => {
      if (!paused && document.visibilityState === 'visible' && document.hasFocus()) {
        start()
        return
      }
      pause()
    }

    sync()
    document.addEventListener('visibilitychange', sync)
    window.addEventListener('focus', sync)
    window.addEventListener('blur', sync)

    return () => {
      document.removeEventListener('visibilitychange', sync)
      window.removeEventListener('focus', sync)
      window.removeEventListener('blur', sync)
      pause()
      clear()
    }
  }, [id, level, paused, onExpire])

  return null
}

function NotificationCard({
  notification,
  onDismiss,
}: {
  readonly notification: VisibleNotification
  readonly onDismiss: (id: string) => void
}) {
  const tone = notificationTone(notification.level)
  const Icon = notificationIcon(notification.level)
  const displayMessage = useChatDisplayText(notification.message)

  return (
    <div
      className={cn(
        'pointer-events-auto relative w-full select-none overflow-visible rounded-lg border px-3.5 py-3 text-sm text-text-primary shadow-xl shadow-bg/25 backdrop-blur-sm',
        tone.border,
      )}
      data-notification-level={notification.level}
    >
      <div className="absolute -top-1.5 -right-1.5 z-20">
        <Button
          aria-label={`Dismiss ${notificationLabel(notification.level).toLowerCase()}`}
          className="size-6 rounded-full border border-border/60 bg-bg-secondary/92 backdrop-blur-sm"
          onClick={() => onDismiss(notification.id)}
          size="icon-xs"
          variant="ghost"
        >
          <X className="size-3" strokeWidth={DISMISS_ICON_STROKE_WIDTH} />
        </Button>
      </div>

      <div className="flex min-w-0 gap-2">
        <Icon className={cn('mt-0.5 size-4 shrink-0', tone.icon)} />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5 pr-4">
          <p className="text-xs font-medium tracking-widest text-text-muted uppercase">
            {notificationLabel(notification.level)}
          </p>
          <p className="min-w-0 text-xs leading-5 text-text-secondary">{displayMessage}</p>
        </div>
      </div>
    </div>
  )
}

/**
 * The corner notification stack.
 *
 * Floats clear of the composer on purpose. The composer area is reserved for requests that hold the
 * run, so anything docked there is something the user must answer; a notice can never be answered,
 * so it belongs somewhere else. Follows T3 Code's placement (`ui/toast.tsx:562`), including the
 * offset below the header so it does not land on the window chrome.
 *
 * Remounted per session by its key at the mount site, so dismissals reset with the session rather
 * than accumulating in a set that only ever grows, and switching away and back cannot resurrect a
 * notice already gone. T3 Code achieves the same by filtering toasts to the active thread.
 */
export function AgentNotificationStack({
  events,
}: {
  readonly events: readonly AgentInteractionEvent[]
}) {
  const [dismissedIds, setDismissedIds] = useState<ReadonlySet<string>>(() => new Set())
  const [expanded, setExpanded] = useState(false)
  const [hovering, setHovering] = useState(false)

  const notifications = useMemo(
    () => toVisibleNotifications(events, dismissedIds),
    [events, dismissedIds],
  )

  const dismiss = useCallback((id: string) => {
    setDismissedIds((current) => new Set(current).add(id))
  }, [])

  const visible = expanded ? notifications : notifications.slice(0, MAX_VISIBLE_NOTIFICATIONS)
  const hiddenCount = notifications.length - visible.length
  const latestDisplayMessage = useChatDisplayText(notifications[0]?.message ?? '')

  return (
    <>
      {/* Every notice owns a clock, including ones behind the visible slots, so a hidden notice
          ages out rather than surfacing later. */}
      {notifications.map((notification) => (
        <NotificationDismissClock
          id={notification.id}
          key={notification.id}
          level={notification.level}
          onExpire={dismiss}
          paused={hovering}
        />
      ))}

      {/* Always mounted, so the newest notice is actually announced. A live region added in the same
          commit as its text is not announced. */}
      <PoliteAnnouncer message={latestDisplayMessage || null} />

      {notifications.length === 0 ? null : (
        <output
          aria-label="Agent notifications"
          className="pointer-events-none absolute top-17 right-4 left-4 z-40 ml-auto flex max-w-90 flex-col gap-3 sm:right-8 sm:left-8"
          onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget)) setHovering(false)
          }}
          onFocus={() => setHovering(true)}
          onMouseEnter={() => {
            setExpanded(true)
            setHovering(true)
          }}
          onMouseLeave={() => {
            setExpanded(false)
            setHovering(false)
          }}
        >
          {visible.map((notification, index) => (
            <div
              className="origin-top transition-transform duration-200"
              key={notification.id}
              style={
                expanded || index === 0
                  ? undefined
                  : {
                      transform: `translateY(${String(index * PEEK_STEP_PX)}px) scale(${String(1 - index * SCALE_STEP)})`,
                      marginTop: `-${String(index * PEEK_STEP_PX)}px`,
                    }
              }
            >
              <NotificationCard notification={notification} onDismiss={dismiss} />
            </div>
          ))}
          {hiddenCount > 0 ? (
            // A button, not inert text: with four or more notices a keyboard-only user could see
            // that more existed and had no way to reach them except dismissing the front ones one
            // at a time. Errors persist, so errors are exactly what queues up here.
            <div className="pointer-events-auto pr-1 text-right">
              <Button
                aria-expanded={expanded}
                className="h-auto px-1 py-0 text-xs text-text-muted"
                onClick={() => setExpanded((current) => !current)}
                size="xs"
                variant="ghost"
              >
                {expanded ? 'Show fewer notices' : `${String(hiddenCount)} more behind`}
              </Button>
            </div>
          ) : null}
        </output>
      )}
    </>
  )
}

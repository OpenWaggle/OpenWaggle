import type { AgentLoopNotifyLevel } from '@shared/types/agent-loop-interaction'
import type { AgentInteractionEvent } from './types-chat-row'

/**
 * How long a notice stays, in milliseconds of window-focused time.
 *
 * `null` means it stays until dismissed. Errors get that, because a notice the user never saw is
 * worse than a stale one, and the transcript already holds the durable copy of warnings and errors.
 */
const NOTIFICATION_LIFETIME_MS = {
  info: 5000,
  warning: 5000,
  error: null,
} satisfies Record<AgentLoopNotifyLevel, number | null>

/** Most severe first. Time only breaks ties within a severity. */
const NOTIFICATION_SEVERITY_RANK = {
  error: 0,
  warning: 1,
  info: 2,
} satisfies Record<AgentLoopNotifyLevel, number>

/**
 * Separate budgets per kind.
 *
 * One shared window let a burst of informational notices evict the authorization request and
 * resolution events behind them, which made an Ask-mode transcript row either vanish or stay stuck
 * on "Waiting" after the decision was made. Capping each kind independently means notifications
 * cannot displace decisions no matter how many arrive.
 */
export const NOTIFY_EVENT_BUDGET = 30
export const DECISION_EVENT_BUDGET = 30

export function notificationLifetimeMs(level: AgentLoopNotifyLevel): number | null {
  return NOTIFICATION_LIFETIME_MS[level]
}

export function notificationSeverityRank(level: AgentLoopNotifyLevel): number {
  return NOTIFICATION_SEVERITY_RANK[level]
}

function isNotifyEvent(event: AgentInteractionEvent) {
  return event.type === 'agent_interaction_request'
    ? event.interaction.kind === 'notify'
    : event.kind === 'notify'
}

/**
 * Trims the per-session event log, giving notifications and decisions independent budgets.
 *
 * Order is preserved, so a request still precedes its resolution.
 */
export function capAgentInteractionEvents(
  events: readonly AgentInteractionEvent[],
): readonly AgentInteractionEvent[] {
  const notifyKeep = new Set<AgentInteractionEvent>()
  const decisionKeep = new Set<AgentInteractionEvent>()
  let notifySeen = 0
  let decisionSeen = 0

  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (!event) continue

    if (isNotifyEvent(event)) {
      if (notifySeen < NOTIFY_EVENT_BUDGET) {
        notifyKeep.add(event)
        notifySeen += 1
      }
      continue
    }

    if (decisionSeen < DECISION_EVENT_BUDGET) {
      decisionKeep.add(event)
      decisionSeen += 1
    }
  }

  return events.filter((event) => notifyKeep.has(event) || decisionKeep.has(event))
}

export interface OrderableNotification {
  readonly level: AgentLoopNotifyLevel
  readonly timestamp: number
}

/**
 * Severity first, then newest.
 *
 * Sorting by time alone let three later informational notices push an active error out of the
 * visible slots, and an error never expires on its own, so the user simply lost it.
 */
export function orderNotifications<T extends OrderableNotification>(
  notifications: readonly T[],
): readonly T[] {
  return [...notifications].sort((left, right) => {
    const bySeverity = notificationSeverityRank(left.level) - notificationSeverityRank(right.level)
    return bySeverity !== 0 ? bySeverity : right.timestamp - left.timestamp
  })
}

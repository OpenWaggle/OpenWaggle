import type {
  UsageStatisticsEvent,
  UsageStatisticsEventName,
} from '../../src/shared/usage-statistics/contract'

/**
 * The most events of each kind one request may carry. The app sends one completed UTC day per
 * request with at most these counts (src/main/domain/usage-statistics), so a request beyond
 * them is not from the app and is refused whole rather than partly stored.
 */
const EVENT_LIMITS: readonly (readonly [readonly UsageStatisticsEventName[], number])[] = [
  [['install.active'], 1],
  [['install.new'], 1],
  [['install.onboarding'], 1],
  [['app.opened'], 20],
  [['update.installed'], 5],
  [['run.finished', 'run.compacted'], 150],
]

export type RequestShapeCheck =
  | { readonly ok: true }
  | { readonly ok: false; readonly field: 'day' | 'events'; readonly reason: string }

/** Whether validated events have the shape of one app request: one day, within the limits. */
export function checkRequestShape(events: readonly UsageStatisticsEvent[]): RequestShapeCheck {
  if (new Set(events.map((event) => event.day)).size > 1) {
    return { ok: false, field: 'day', reason: 'events of more than one day' }
  }
  for (const [names, limit] of EVENT_LIMITS) {
    const count = events.filter((event) => names.includes(event.name)).length
    if (count > limit) {
      return { ok: false, field: 'events', reason: `too many ${names.join(' and ')} events` }
    }
  }
  return { ok: true }
}

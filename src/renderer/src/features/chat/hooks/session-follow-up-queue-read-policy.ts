import type { Query } from '@tanstack/react-query'

/**
 * A queue read fails while the Session Host is briefly unreachable: an event-loop stall past the
 * request timeout, a reconnect, an update relaunch. The cached queue never goes stale on its own,
 * and the app's queries retry nothing by default, so one failed read kept "Follow-up queue
 * unavailable" up until the user pressed Retry or the Session changed state. The read now retries
 * a transient failure before reporting it, and keeps re-reading while it is failing.
 */
export const FOLLOW_UP_QUEUE_READ_RETRIES = 2
export const FOLLOW_UP_QUEUE_RECOVERY_INTERVAL_MS = 5_000
const RETRY_BASE_DELAY_MS = 500
const RETRY_MAX_DELAY_MS = 2_000
const RETRY_BACKOFF_FACTOR = 2

export function followUpQueueRetryDelay(failureCount: number) {
  return Math.min(
    RETRY_BASE_DELAY_MS * RETRY_BACKOFF_FACTOR ** Math.max(0, failureCount - 1),
    RETRY_MAX_DELAY_MS,
  )
}

/** Re-read on an interval only while the last read failed. */
export function followUpQueueRecoveryInterval(query: Pick<Query, 'state'>) {
  return query.state.status === 'error' ? FOLLOW_UP_QUEUE_RECOVERY_INTERVAL_MS : false
}

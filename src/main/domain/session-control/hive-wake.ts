/**
 * The refusal of a Hive wake whose parent no longer needs it by the time its `start` runs: it got
 * a Run, a Follow-up (one paused at the Worker limits does not count), or was archived after the
 * Host checked it (`hive-parent-wake.ts`).
 */
export const HIVE_WAKE_NOT_NEEDED = 'hive_wake_not_needed'

/**
 * Why a Hive wake did not start: no pending update it would act on has a cause that may wake the
 * parent (an external client not behind the parent's latest Run, or a cause the Host cannot
 * identify), so the updates wait for its next Run.
 */
export const HIVE_WAKE_CAUSE_MAY_NOT_WAKE = 'hive_wake_cause_may_not_wake'

const HIVE_WAKE_KEY_PREFIX = 'hive-wake:'
const AGENTS_WAKE_MARK = 'agents:'

/**
 * The request key of a Hive wake. It marks a wake that something outside the Queen's Hive caused
 * as agents' work, so the Worker limits hold it and count it while it runs (ADR 0030, amended
 * 2026-11-09); only the Host starts wakes, so no client can set the mark.
 */
export function hiveWakeKey(parentSessionId: string, id: string, causedOutsideHive: boolean) {
  const mark = causedOutsideHive ? AGENTS_WAKE_MARK : ''
  return `${HIVE_WAKE_KEY_PREFIX}${mark}${parentSessionId}:${id}`
}

/** Whether a wake's key marks it as agents' work (`hiveWakeKey`). */
export function isAgentsHiveWakeKey(key: string | undefined) {
  return key?.startsWith(`${HIVE_WAKE_KEY_PREFIX}${AGENTS_WAKE_MARK}`) === true
}

/** The same wake's key, marked as agents' work. */
export function asAgentsHiveWakeKey(key: string) {
  if (isAgentsHiveWakeKey(key) || !key.startsWith(HIVE_WAKE_KEY_PREFIX)) return key
  return `${HIVE_WAKE_KEY_PREFIX}${AGENTS_WAKE_MARK}${key.slice(HIVE_WAKE_KEY_PREFIX.length)}`
}

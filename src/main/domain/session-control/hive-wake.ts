import { isProfileCallerId } from './root-session-project-reach'

/**
 * The refusal of a Hive wake whose parent no longer needs it by the time its `start` runs: it got
 * a Run, a Follow-up, or was archived after the Host checked it (`hive-parent-wake.ts`).
 */
export const HIVE_WAKE_NOT_NEEDED = 'hive_wake_not_needed'

/**
 * Whether a Worker change by `callerId` (a result, a request for help, or a Run that ended) may
 * wake the Worker's parent. A CLI client profile may contribute to a Worker or message it without
 * any right to start Runs on its parent, so its change reaches a running parent and otherwise
 * waits for the parent's next Run. The desktop user and OpenWaggle's own Session agents, whose
 * grants derive from the user's, may wake it: a Hive's Workers drive each other too.
 */
export function workerChangeMayWakeParent(callerId: string) {
  return !isProfileCallerId(callerId)
}

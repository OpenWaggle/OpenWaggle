/**
 * The refusal of a Hive wake whose parent no longer needs it by the time its `start` runs: it got
 * a Run, a Follow-up, or was archived after the Host checked it (`hive-parent-wake.ts`).
 */
export const HIVE_WAKE_NOT_NEEDED = 'hive_wake_not_needed'

/**
 * Why a Hive wake did not start: no pending update it would act on has a cause that may wake the
 * parent (an external client not behind the parent's latest Run, or a cause the Host cannot
 * identify), so the updates wait for its next Run.
 */
export const HIVE_WAKE_CAUSE_MAY_NOT_WAKE = 'hive_wake_cause_may_not_wake'

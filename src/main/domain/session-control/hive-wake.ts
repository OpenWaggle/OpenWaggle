/**
 * The refusal of a Hive wake whose parent no longer needs it by the time its `start` runs: it got
 * a Run, a Follow-up, or was archived after the Host checked it (`hive-parent-wake.ts`).
 */
export const HIVE_WAKE_NOT_NEEDED = 'hive_wake_not_needed'

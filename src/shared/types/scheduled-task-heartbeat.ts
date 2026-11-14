import type { SchemaType } from '@shared/schema'
import type {
  heartbeatAutoPauseSchema,
  heartbeatSettingsInputSchema,
  heartbeatSettingsSchema,
  scheduledTaskRunOutcomeSchema,
  scheduledTaskRunWakeCheckSchema,
  heartbeatWakeCheckSchema,
} from '@shared/schemas/scheduled-task-heartbeat'

/**
 * What makes a Heartbeat cheap and finite (#388, ADR 0057 amendment): an optional Wake check the
 * Host runs before each firing, a Stop condition every Heartbeat needs, the Run outcome each
 * Heartbeat Run reports or has inferred, and the Auto-pause that follows idle or done runs.
 * None of it applies to a Launch schedule, whose `heartbeat` settings are null.
 */

export const HEARTBEAT_STOP_WHEN_MAX_LENGTH = 1_000
export const HEARTBEAT_WAKE_CHECK_MAX_LENGTH = 4_000
export const HEARTBEAT_OUTCOME_NOTE_MAX_LENGTH = 500
export const HEARTBEAT_IDLE_PAUSE_MIN = 1
export const HEARTBEAT_IDLE_PAUSE_MAX = 20
export const HEARTBEAT_IDLE_PAUSE_DEFAULT = 3
/** A Wake check that has not exited by then is stopped and reported as failed. */
export const HEARTBEAT_WAKE_CHECK_TIMEOUT_MS = 30_000
/** Output a Wake check may print, per stream, before the rest is dropped. */
export const HEARTBEAT_WAKE_CHECK_OUTPUT_LIMIT_BYTES = 16 * 1024

export const HEARTBEAT_RUN_OUTCOMES = ['acted', 'idle', 'done'] as const
/** What a Heartbeat Run did (CONTEXT.md: Run outcome). */
export type HeartbeatRunOutcome = (typeof HEARTBEAT_RUN_OUTCOMES)[number]

export type ScheduledTaskRunOutcome = SchemaType<typeof scheduledTaskRunOutcomeSchema>

export const HEARTBEAT_WAKE_CHECK_FAILURE_POLICIES = ['wake', 'skip'] as const
/** What a failed or timed-out Wake check does: start the Run anyway (default) or skip it. */
export type HeartbeatWakeCheckFailurePolicy = (typeof HEARTBEAT_WAKE_CHECK_FAILURE_POLICIES)[number]

/**
 * `pending` holds the Heartbeat until the user approves this exact command: its Session asks for
 * approval and someone other than the user set the command. `not-required` runs it now.
 */
export const HEARTBEAT_WAKE_CHECK_APPROVALS = ['not-required', 'pending', 'approved'] as const

export type HeartbeatWakeCheck = SchemaType<typeof heartbeatWakeCheckSchema>

export const HEARTBEAT_AUTO_PAUSE_REASONS = ['done', 'idle'] as const

export type HeartbeatAutoPause = SchemaType<typeof heartbeatAutoPauseSchema>
export type HeartbeatSettings = SchemaType<typeof heartbeatSettingsSchema>
export type HeartbeatSettingsInput = SchemaType<typeof heartbeatSettingsInputSchema>
export type ScheduledTaskRunWakeCheck = SchemaType<typeof scheduledTaskRunWakeCheckSchema>

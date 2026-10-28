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

/** Whether the outcome was reported by the Run or inferred from the tools it used. */
export type HeartbeatRunOutcomeSource = 'reported' | 'inferred'

export interface ScheduledTaskRunOutcome {
  readonly value: HeartbeatRunOutcome
  readonly source: HeartbeatRunOutcomeSource
  /** Why, in the agent's words, when it reported one. */
  readonly note?: string
}

export const HEARTBEAT_WAKE_CHECK_FAILURE_POLICIES = ['wake', 'skip'] as const
/** What a failed or timed-out Wake check does: start the Run anyway (default) or skip it. */
export type HeartbeatWakeCheckFailurePolicy = (typeof HEARTBEAT_WAKE_CHECK_FAILURE_POLICIES)[number]

export const HEARTBEAT_WAKE_CHECK_APPROVALS = ['not-required', 'pending', 'approved'] as const
/**
 * `pending` holds the Heartbeat until the user approves this exact command: its Session asks for
 * approval and someone other than the user set the command. `not-required` runs it now.
 */
export type HeartbeatWakeCheckApproval = (typeof HEARTBEAT_WAKE_CHECK_APPROVALS)[number]

/** The Wake check a caller sets. */
export interface HeartbeatWakeCheckInput {
  /** A shell command run in the Heartbeat's Session workspace before each firing. */
  readonly command: string
  /** Omitted: `wake`. */
  readonly onFailure?: HeartbeatWakeCheckFailurePolicy
}

export interface HeartbeatWakeCheck {
  readonly command: string
  readonly onFailure: HeartbeatWakeCheckFailurePolicy
  readonly approval: HeartbeatWakeCheckApproval
  /** When the Host first held the Heartbeat for approval of this command. */
  readonly pendingSince: number | null
}

export const HEARTBEAT_AUTO_PAUSE_REASONS = ['done', 'idle'] as const
export type HeartbeatAutoPauseReason = (typeof HEARTBEAT_AUTO_PAUSE_REASONS)[number]

/** Why the Host turned a Heartbeat off by itself; cleared when it is turned back on. */
export interface HeartbeatAutoPause {
  readonly reason: HeartbeatAutoPauseReason
  /** `auto-paused: done` or `auto-paused: 3 idle runs`, with the agent's note when it gave one. */
  readonly message: string
  readonly since: number
}

/** A Heartbeat's own settings and state; null on a Launch schedule. */
export interface HeartbeatSettings {
  /** The plain-language outcome after which the Heartbeat should stop (CONTEXT.md). */
  readonly stopWhen: string | null
  /** Set explicitly, or by migration for a Heartbeat created before stop conditions. */
  readonly indefinite: boolean
  /** Consecutive idle runs, 1-20, after which the Host pauses the Heartbeat. */
  readonly idlePauseAfter: number
  readonly wakeCheck: HeartbeatWakeCheck | null
  readonly consecutiveIdleRuns: number
  readonly autoPause: HeartbeatAutoPause | null
}

/** The Heartbeat settings a caller sets; an omitted field keeps its value (or its default). */
export interface HeartbeatSettingsInput {
  readonly stopWhen?: string | null
  readonly indefinite?: boolean
  readonly idlePauseAfter?: number
  /** null removes the Wake check. */
  readonly wakeCheck?: HeartbeatWakeCheckInput | null
}

/** What the Wake check decided for one firing, recorded on its run. */
export type ScheduledTaskRunWakeCheck = 'idle' | 'woke' | 'failed'

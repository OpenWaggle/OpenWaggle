import { Schema } from '@shared/schema'
import {
  HEARTBEAT_AUTO_PAUSE_REASONS,
  HEARTBEAT_IDLE_PAUSE_MAX,
  HEARTBEAT_IDLE_PAUSE_MIN,
  HEARTBEAT_OUTCOME_NOTE_MAX_LENGTH,
  HEARTBEAT_RUN_OUTCOMES,
  HEARTBEAT_STOP_WHEN_MAX_LENGTH,
  HEARTBEAT_WAKE_CHECK_APPROVALS,
  HEARTBEAT_WAKE_CHECK_FAILURE_POLICIES,
  HEARTBEAT_WAKE_CHECK_MAX_LENGTH,
} from '@shared/types/scheduled-task-heartbeat'

/**
 * The one source of the Heartbeat types in `@shared/types/scheduled-task-heartbeat` (#388,
 * ADR 0057 amendment): what a caller sets, and the settings and state the Host reports.
 */

const timestampSchema = Schema.Number.pipe(Schema.int(), Schema.nonNegative())

const nonBlank = (message: string) =>
  Schema.String.pipe(Schema.filter((value) => value.trim().length > 0 || message))

export const heartbeatStopWhenSchema = nonBlank('A Stop condition cannot be blank.').pipe(
  Schema.maxLength(HEARTBEAT_STOP_WHEN_MAX_LENGTH),
)

export const heartbeatWakeCheckCommandSchema = nonBlank('A Wake check needs a command.').pipe(
  Schema.maxLength(HEARTBEAT_WAKE_CHECK_MAX_LENGTH),
)

export const heartbeatIdlePauseAfterSchema = Schema.Number.pipe(
  Schema.int(),
  Schema.between(HEARTBEAT_IDLE_PAUSE_MIN, HEARTBEAT_IDLE_PAUSE_MAX),
)

export const heartbeatRunOutcomeSchema = Schema.Literal(...HEARTBEAT_RUN_OUTCOMES)

export const heartbeatOutcomeNoteSchema = Schema.String.pipe(
  Schema.maxLength(HEARTBEAT_OUTCOME_NOTE_MAX_LENGTH),
)

const failurePolicySchema = Schema.Literal(...HEARTBEAT_WAKE_CHECK_FAILURE_POLICIES)

/** The Wake check a caller sets. */
export const heartbeatWakeCheckInputSchema = Schema.Struct({
  /** A shell command run in the Heartbeat's Session workspace before each firing. */
  command: heartbeatWakeCheckCommandSchema,
  /** Omitted: `wake`. */
  onFailure: Schema.optionalWith(failurePolicySchema, { exact: true }),
})

/** The Heartbeat settings a caller sets; an omitted field keeps its value (or its default). */
export const heartbeatSettingsInputSchema = Schema.Struct({
  stopWhen: Schema.optionalWith(Schema.NullOr(heartbeatStopWhenSchema), { exact: true }),
  indefinite: Schema.optionalWith(Schema.Boolean, { exact: true }),
  idlePauseAfter: Schema.optionalWith(heartbeatIdlePauseAfterSchema, { exact: true }),
  /** null removes the Wake check. */
  wakeCheck: Schema.optionalWith(Schema.NullOr(heartbeatWakeCheckInputSchema), { exact: true }),
})

export const heartbeatWakeCheckSchema = Schema.Struct({
  command: Schema.String,
  onFailure: failurePolicySchema,
  approval: Schema.Literal(...HEARTBEAT_WAKE_CHECK_APPROVALS),
  /** When the Host first held the Heartbeat for approval of this command. */
  pendingSince: Schema.NullOr(timestampSchema),
})

/** Why the Host turned a Heartbeat off by itself; cleared when it is turned back on. */
export const heartbeatAutoPauseSchema = Schema.Struct({
  reason: Schema.Literal(...HEARTBEAT_AUTO_PAUSE_REASONS),
  /** `auto-paused: done` or `auto-paused: 3 idle runs`, with the agent's note when it gave one. */
  message: Schema.String,
  since: timestampSchema,
})

/** A Heartbeat's own settings and state; null on a Launch schedule. */
export const heartbeatSettingsSchema = Schema.Struct({
  /** The plain-language outcome after which the Heartbeat should stop (CONTEXT.md). */
  stopWhen: Schema.NullOr(Schema.String),
  /** Set explicitly, or by migration for a Heartbeat created before stop conditions. */
  indefinite: Schema.Boolean,
  /** Consecutive idle runs, 1-20, after which the Host pauses the Heartbeat. */
  idlePauseAfter: Schema.Number.pipe(Schema.int()),
  wakeCheck: Schema.NullOr(heartbeatWakeCheckSchema),
  consecutiveIdleRuns: Schema.Number.pipe(Schema.int(), Schema.nonNegative()),
  autoPause: Schema.NullOr(heartbeatAutoPauseSchema),
})

export const scheduledTaskRunOutcomeSchema = Schema.Struct({
  value: heartbeatRunOutcomeSchema,
  /** Whether the outcome was reported by the Run or inferred from the tools it used. */
  source: Schema.Literal('reported', 'inferred'),
  /** Why, in the agent's words, when it reported one. */
  note: Schema.optionalWith(Schema.String, { exact: true }),
})

/** What the Wake check decided for one firing, recorded on its run. */
export const scheduledTaskRunWakeCheckSchema = Schema.Literal('idle', 'woke', 'failed')

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
  type HeartbeatSettings,
  type HeartbeatSettingsInput,
  type ScheduledTaskRunOutcome,
} from '@shared/types/scheduled-task-heartbeat'

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

export const heartbeatSettingsInputSchema: Schema.Schema<HeartbeatSettingsInput> = Schema.Struct({
  stopWhen: Schema.optional(Schema.NullOr(heartbeatStopWhenSchema)),
  indefinite: Schema.optional(Schema.Boolean),
  idlePauseAfter: Schema.optional(heartbeatIdlePauseAfterSchema),
  wakeCheck: Schema.optional(
    Schema.NullOr(
      Schema.Struct({
        command: heartbeatWakeCheckCommandSchema,
        onFailure: Schema.optional(failurePolicySchema),
      }),
    ),
  ),
})

export const heartbeatSettingsSchema: Schema.Schema<HeartbeatSettings> = Schema.Struct({
  stopWhen: Schema.NullOr(Schema.String),
  indefinite: Schema.Boolean,
  idlePauseAfter: Schema.Number.pipe(Schema.int()),
  wakeCheck: Schema.NullOr(
    Schema.Struct({
      command: Schema.String,
      onFailure: failurePolicySchema,
      approval: Schema.Literal(...HEARTBEAT_WAKE_CHECK_APPROVALS),
      pendingSince: Schema.NullOr(timestampSchema),
    }),
  ),
  consecutiveIdleRuns: Schema.Number.pipe(Schema.int(), Schema.nonNegative()),
  autoPause: Schema.NullOr(
    Schema.Struct({
      reason: Schema.Literal(...HEARTBEAT_AUTO_PAUSE_REASONS),
      message: Schema.String,
      since: timestampSchema,
    }),
  ),
})

export const scheduledTaskRunOutcomeSchema: Schema.Schema<ScheduledTaskRunOutcome> = Schema.Struct({
  value: heartbeatRunOutcomeSchema,
  source: Schema.Literal('reported', 'inferred'),
  note: Schema.optional(Schema.String),
})

export const scheduledTaskRunWakeCheckSchema = Schema.Literal('idle', 'woke', 'failed')

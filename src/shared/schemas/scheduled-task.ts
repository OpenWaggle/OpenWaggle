/**
 * What a caller asks of Scheduled tasks (ADR 0057, ADR 0058). Each schema is the one source of
 * its type in `@shared/types/scheduled-task`; the Session Host decodes the request with it.
 */
import { decodeUnknownExactOrThrow, Schema } from '@shared/schema'
import {
  SCHEDULED_TASK_MAX_RUNS_LIMIT,
  SCHEDULED_TASK_NAME_MAX_LENGTH,
  SCHEDULED_TASK_PROMPT_MAX_LENGTH,
  SCHEDULED_TASK_RUN_PAGE_LIMIT,
  SCHEDULED_TASK_TIME_ZONE_MAX_LENGTH,
  SCHEDULED_TASKS_CONTRACT_VERSION,
} from '@shared/types/scheduled-task'
import {
  heartbeatOutcomeNoteSchema,
  heartbeatRunOutcomeSchema,
  heartbeatSettingsInputSchema,
  heartbeatWakeCheckCommandSchema,
} from './scheduled-task-heartbeat'
import { scheduledTasksResponseSchema } from './scheduled-task-records'
import {
  notificationPolicySchema,
  scheduledTaskTargetSchema,
  taskScheduleSchema,
} from './scheduled-task-schedule'
import { sessionInputIdSchema, sessionInputPathSchema } from './session-input'

const timestampSchema = Schema.Number.pipe(Schema.int(), Schema.nonNegative())

const taskNameSchema = Schema.String.pipe(
  Schema.filter((value) => value.trim().length > 0 || 'A Scheduled task needs a name.'),
  Schema.maxLength(SCHEDULED_TASK_NAME_MAX_LENGTH),
)

const taskPromptSchema = Schema.String.pipe(
  Schema.filter((value) => value.trim().length > 0 || 'A Scheduled task needs a prompt.'),
  Schema.maxLength(SCHEDULED_TASK_PROMPT_MAX_LENGTH),
)

const timeZoneSchema = Schema.String.pipe(
  Schema.minLength(1),
  Schema.maxLength(SCHEDULED_TASK_TIME_ZONE_MAX_LENGTH),
)

const endsAtSchema = Schema.NullOr(timestampSchema)
const maxRunsSchema = Schema.NullOr(
  Schema.Number.pipe(Schema.int(), Schema.between(1, SCHEDULED_TASK_MAX_RUNS_LIMIT)),
)

/** What a caller sets when creating a Scheduled task. */
export const scheduledTaskInputSchema = Schema.Struct({
  name: taskNameSchema,
  prompt: taskPromptSchema,
  enabled: Schema.Boolean,
  schedule: taskScheduleSchema,
  /** Omitted: the machine's time zone. */
  timeZone: Schema.optionalWith(timeZoneSchema, { exact: true }),
  endsAt: Schema.optionalWith(endsAtSchema, { exact: true }),
  maxRuns: Schema.optionalWith(maxRunsSchema, { exact: true }),
  target: scheduledTaskTargetSchema,
  /** Omitted: failures only for a Heartbeat, every run for a Launch schedule. */
  notificationPolicy: Schema.optionalWith(notificationPolicySchema, { exact: true }),
  /** A Heartbeat needs `stopWhen`, `indefinite`, `endsAt` or `maxRuns` (#388). */
  heartbeat: Schema.optionalWith(heartbeatSettingsInputSchema, { exact: true }),
})

/** A partial update; the kind and Heartbeat target Session cannot change. */
export const scheduledTaskPatchSchema = Schema.Struct({
  name: Schema.optionalWith(taskNameSchema, { exact: true }),
  prompt: Schema.optionalWith(taskPromptSchema, { exact: true }),
  enabled: Schema.optionalWith(Schema.Boolean, { exact: true }),
  schedule: Schema.optionalWith(taskScheduleSchema, { exact: true }),
  timeZone: Schema.optionalWith(timeZoneSchema, { exact: true }),
  endsAt: Schema.optionalWith(endsAtSchema, { exact: true }),
  maxRuns: Schema.optionalWith(maxRunsSchema, { exact: true }),
  target: Schema.optionalWith(scheduledTaskTargetSchema, { exact: true }),
  notificationPolicy: Schema.optionalWith(notificationPolicySchema, { exact: true }),
  heartbeat: Schema.optionalWith(heartbeatSettingsInputSchema, { exact: true }),
})

export const scheduledTasksCommandSchema = Schema.Union(
  Schema.Struct({
    operation: Schema.Literal('list'),
    projectPath: Schema.optionalWith(sessionInputPathSchema, { exact: true }),
    sessionId: Schema.optionalWith(sessionInputIdSchema, { exact: true }),
  }),
  Schema.Struct({ operation: Schema.Literal('read'), taskId: sessionInputIdSchema }),
  Schema.Struct({
    operation: Schema.Literal('runs'),
    taskId: sessionInputIdSchema,
    limit: Schema.optionalWith(
      Schema.Number.pipe(Schema.int(), Schema.between(1, SCHEDULED_TASK_RUN_PAGE_LIMIT)),
      { exact: true },
    ),
    /** Runs fired before this time. */
    before: Schema.optionalWith(timestampSchema, { exact: true }),
  }),
  Schema.Struct({ operation: Schema.Literal('create'), input: scheduledTaskInputSchema }),
  Schema.Struct({
    operation: Schema.Literal('update'),
    taskId: sessionInputIdSchema,
    patch: scheduledTaskPatchSchema,
  }),
  Schema.Struct({ operation: Schema.Literal('delete'), taskId: sessionInputIdSchema }),
  Schema.Struct({ operation: Schema.Literal('run-now'), taskId: sessionInputIdSchema }),
  /** The user approves this exact Wake check command, which releases a held Heartbeat. */
  Schema.Struct({
    operation: Schema.Literal('approve-wake-check'),
    taskId: sessionInputIdSchema,
    command: heartbeatWakeCheckCommandSchema,
  }),
  /** A Heartbeat Run reports its Run outcome; `runId` is that Session Run's id. */
  Schema.Struct({
    operation: Schema.Literal('report-outcome'),
    runId: sessionInputIdSchema,
    outcome: heartbeatRunOutcomeSchema,
    note: Schema.optionalWith(heartbeatOutcomeNoteSchema, { exact: true }),
  }),
)

export const scheduledTasksRequestSchema = Schema.Struct({
  contractVersion: Schema.Literal(SCHEDULED_TASKS_CONTRACT_VERSION),
  requestId: sessionInputIdSchema,
  idempotencyKey: Schema.optionalWith(sessionInputIdSchema, { exact: true }),
  command: scheduledTasksCommandSchema,
})

export function decodeScheduledTasksRequest(value: unknown) {
  return decodeUnknownExactOrThrow(scheduledTasksRequestSchema, value)
}

export function decodeScheduledTasksResponse(value: unknown) {
  return decodeUnknownExactOrThrow(scheduledTasksResponseSchema, value)
}

export function decodeTaskSchedule(value: unknown) {
  return decodeUnknownExactOrThrow(taskScheduleSchema, value)
}

export function decodeScheduledTaskTarget(value: unknown) {
  return decodeUnknownExactOrThrow(scheduledTaskTargetSchema, value)
}

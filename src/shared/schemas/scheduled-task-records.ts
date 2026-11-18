/**
 * What the Session Host reports about Scheduled tasks (ADR 0057, ADR 0058): a task, one of its
 * runs, and the answer to a Scheduled task operation. Each schema is the one source of its type
 * in `@shared/types/scheduled-task`; the window decodes the Host's answer with it.
 */
import { SESSION_HOST_ERROR_KINDS } from '@shared/domain/session-host-refusals'
import { Schema } from '@shared/schema'
import {
  SCHEDULED_TASK_ATTENTION_REASONS,
  SCHEDULED_TASK_KINDS,
  SCHEDULED_TASK_REJECTION_CODES,
  SCHEDULED_TASK_RUN_REASONS,
  SCHEDULED_TASK_RUN_STATUSES,
  SCHEDULED_TASKS_CONTRACT_VERSION,
  SCHEDULED_TASKS_OPERATIONS,
} from '@shared/types/scheduled-task'
import {
  heartbeatSettingsSchema,
  scheduledTaskRunOutcomeSchema,
  scheduledTaskRunWakeCheckSchema,
} from './scheduled-task-heartbeat'
import {
  notificationPolicySchema,
  scheduledTaskTargetSchema,
  taskScheduleSchema,
} from './scheduled-task-schedule'

const timestampSchema = Schema.Number.pipe(Schema.int(), Schema.nonNegative())
const countSchema = Schema.Number.pipe(Schema.int(), Schema.nonNegative())

export const scheduledTaskAttentionSchema = Schema.Struct({
  reason: Schema.Literal(...SCHEDULED_TASK_ATTENTION_REASONS),
  message: Schema.String,
  since: timestampSchema,
})

/** Who created a Scheduled task, for display; its authority is revalidated at every run. */
export const scheduledTaskCreatorSchema = Schema.Struct({
  kind: Schema.Literal('local-user', 'profile', 'session-agent'),
  label: Schema.String,
  sessionId: Schema.optionalWith(Schema.String, { exact: true }),
})

export const scheduledTaskRunTriggerSchema = Schema.Literal('schedule', 'catch-up', 'run-now')

/** One firing of a Scheduled task (CONTEXT.md: Scheduled task run). */
export const scheduledTaskRunSchema = Schema.Struct({
  id: Schema.String,
  taskId: Schema.String,
  trigger: scheduledTaskRunTriggerSchema,
  /** The fire time the Task schedule named; for a catch-up, the latest one it covers. */
  nominalAt: timestampSchema,
  firedAt: timestampSchema,
  /** Firings missed while the Host was down or the machine slept, covered by this one run. */
  missedCount: countSchema,
  status: Schema.Literal(...SCHEDULED_TASK_RUN_STATUSES),
  reason: Schema.optionalWith(Schema.Literal(...SCHEDULED_TASK_RUN_REASONS), { exact: true }),
  message: Schema.optionalWith(Schema.String, { exact: true }),
  /** The Session the run delivered into (Heartbeat) or launched (Launch schedule). */
  sessionId: Schema.optionalWith(Schema.String, { exact: true }),
  runId: Schema.optionalWith(Schema.String, { exact: true }),
  /** What a Heartbeat's Wake check decided for this firing. */
  wakeCheck: Schema.optionalWith(scheduledTaskRunWakeCheckSchema, { exact: true }),
  /** A Heartbeat Run's Run outcome, once reported or inferred. */
  outcome: Schema.optionalWith(scheduledTaskRunOutcomeSchema, { exact: true }),
})

export const scheduledTaskSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  prompt: Schema.String,
  kind: Schema.Literal(...SCHEDULED_TASK_KINDS),
  enabled: Schema.Boolean,
  schedule: taskScheduleSchema,
  /** IANA time zone the schedule is read in, stored when the task was created. */
  timeZone: Schema.String,
  endsAt: Schema.NullOr(timestampSchema),
  maxRuns: Schema.NullOr(countSchema),
  target: scheduledTaskTargetSchema,
  notificationPolicy: notificationPolicySchema,
  /** The project the task belongs to: the Heartbeat target's or the Launch schedule's. */
  projectPath: Schema.NullOr(Schema.String),
  creator: scheduledTaskCreatorSchema,
  attention: Schema.NullOr(scheduledTaskAttentionSchema),
  /** Next fire time, jitter included; null while disabled or once the schedule has ended. */
  nextRunAt: Schema.NullOr(timestampSchema),
  /** The nominal time of the next firing, which the history shows beside the actual time. */
  nextNominalAt: Schema.NullOr(timestampSchema),
  /** A Heartbeat waiting for its Session to become idle since this time. */
  waitingSince: Schema.NullOr(timestampSchema),
  runCount: countSchema,
  lastRun: Schema.NullOr(scheduledTaskRunSchema),
  heartbeat: Schema.NullOr(heartbeatSettingsSchema),
  /** Sessions this task's recent runs started or delivered into, newest first. */
  recentSessionIds: Schema.Array(Schema.String),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
})

/** A Scheduled task operation the Session Host refused. */
export const scheduledTasksRejectedOutcomeSchema = Schema.Struct({
  effect: Schema.Literal('rejected'),
  code: Schema.Literal(...SCHEDULED_TASK_REJECTION_CODES),
  /** The kind of refusal, from the Session Host's refusal table (ADR 0063). */
  kind: Schema.Literal(...SESSION_HOST_ERROR_KINDS),
  message: Schema.String,
})

export const scheduledTasksOutcomeSchema = Schema.Union(
  Schema.Struct({ effect: Schema.Literal('listed'), tasks: Schema.Array(scheduledTaskSchema) }),
  Schema.Struct({
    effect: Schema.Literal('read'),
    task: scheduledTaskSchema,
    runs: Schema.Array(scheduledTaskRunSchema),
  }),
  Schema.Struct({
    effect: Schema.Literal('runs-listed'),
    runs: Schema.Array(scheduledTaskRunSchema),
  }),
  Schema.Struct({ effect: Schema.Literal('created'), task: scheduledTaskSchema }),
  Schema.Struct({ effect: Schema.Literal('updated'), task: scheduledTaskSchema }),
  Schema.Struct({ effect: Schema.Literal('deleted'), taskId: Schema.String }),
  Schema.Struct({ effect: Schema.Literal('run-requested'), task: scheduledTaskSchema }),
  Schema.Struct({
    effect: Schema.Literal('outcome-recorded'),
    task: scheduledTaskSchema,
    run: scheduledTaskRunSchema,
  }),
  scheduledTasksRejectedOutcomeSchema,
)

export const scheduledTasksOperationSchema = Schema.Literal(...SCHEDULED_TASKS_OPERATIONS)

export const scheduledTasksResponseSchema = Schema.Struct({
  contractVersion: Schema.Literal(SCHEDULED_TASKS_CONTRACT_VERSION),
  requestId: Schema.String,
  operation: scheduledTasksOperationSchema,
  outcome: scheduledTasksOutcomeSchema,
})

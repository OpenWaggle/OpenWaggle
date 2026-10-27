import { decodeUnknownExactOrThrow, Schema } from '@shared/schema'
import {
  ISO_WEEKDAYS,
  SCHEDULED_TASK_ATTENTION_REASONS,
  SCHEDULED_TASK_KINDS,
  SCHEDULED_TASK_MAX_INTERVAL_MINUTES,
  SCHEDULED_TASK_MAX_RUNS_LIMIT,
  SCHEDULED_TASK_NAME_MAX_LENGTH,
  SCHEDULED_TASK_PROMPT_MAX_LENGTH,
  SCHEDULED_TASK_REJECTION_CODES,
  SCHEDULED_TASK_RRULE_MAX_LENGTH,
  SCHEDULED_TASK_RUN_PAGE_LIMIT,
  SCHEDULED_TASK_RUN_REASONS,
  SCHEDULED_TASK_RUN_STATUSES,
  SCHEDULED_TASK_TIME_ZONE_MAX_LENGTH,
  SCHEDULED_TASKS_CONTRACT_VERSION,
  SCHEDULED_TASKS_OPERATIONS,
  type ScheduledTask,
  type ScheduledTaskInput,
  type ScheduledTaskPatch,
  type ScheduledTaskRun,
  type ScheduledTasksCommand,
  type ScheduledTasksRequest,
  type ScheduledTasksResponse,
  type ScheduledTaskTarget,
  type TaskSchedule,
} from '@shared/types/scheduled-task'
import { THINKING_LEVELS } from '@shared/types/settings'
import {
  heartbeatOutcomeNoteSchema,
  heartbeatRunOutcomeSchema,
  heartbeatSettingsInputSchema,
  heartbeatSettingsSchema,
  heartbeatWakeCheckCommandSchema,
  scheduledTaskRunOutcomeSchema,
  scheduledTaskRunWakeCheckSchema,
} from './scheduled-task-heartbeat'
import { sessionInputIdSchema, sessionInputPathSchema } from './session-input'

const MODEL_ID_MAX_LENGTH = 256
const AGENT_DEFINITION_NAME_MAX_LENGTH = 128
const DAYS_PER_WEEK = 7

const timestampSchema = Schema.Number.pipe(Schema.int(), Schema.nonNegative())
const countSchema = Schema.Number.pipe(Schema.int(), Schema.nonNegative())

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

export const taskScheduleSchema: Schema.Schema<TaskSchedule> = Schema.Union(
  Schema.Struct({
    kind: Schema.Literal('interval'),
    everyMinutes: Schema.Number.pipe(
      Schema.int(),
      Schema.between(1, SCHEDULED_TASK_MAX_INTERVAL_MINUTES),
    ),
  }),
  Schema.Struct({
    kind: Schema.Literal('daily'),
    at: Schema.String.pipe(Schema.pattern(/^([01]\d|2[0-3]):[0-5]\d$/)),
    weekdays: Schema.optional(
      Schema.Array(Schema.Literal(...ISO_WEEKDAYS)).pipe(
        Schema.minItems(1),
        Schema.maxItems(DAYS_PER_WEEK),
      ),
    ),
  }),
  Schema.Struct({
    kind: Schema.Literal('rrule'),
    rule: Schema.String.pipe(
      Schema.minLength(1),
      Schema.maxLength(SCHEDULED_TASK_RRULE_MAX_LENGTH),
    ),
  }),
)

const modelChoiceFields = {
  modelId: Schema.optional(
    Schema.String.pipe(Schema.minLength(1), Schema.maxLength(MODEL_ID_MAX_LENGTH)),
  ),
  thinkingLevel: Schema.optional(Schema.Literal(...THINKING_LEVELS)),
}

export const scheduledTaskTargetSchema: Schema.Schema<ScheduledTaskTarget> = Schema.Union(
  Schema.Struct({
    kind: Schema.Literal('heartbeat'),
    sessionId: sessionInputIdSchema,
    ...modelChoiceFields,
  }),
  Schema.Struct({
    kind: Schema.Literal('launch'),
    projectPath: sessionInputPathSchema.pipe(Schema.minLength(1)),
    workspace: Schema.Literal('new-worktree', 'local'),
    ...modelChoiceFields,
    agentDefinitionName: Schema.optional(
      Schema.String.pipe(Schema.minLength(1), Schema.maxLength(AGENT_DEFINITION_NAME_MAX_LENGTH)),
    ),
    archiveFinishedSessions: Schema.Boolean,
  }),
)

const notificationPolicySchema = Schema.Literal('every-run', 'failures-only')
const endsAtSchema = Schema.NullOr(timestampSchema)
const maxRunsSchema = Schema.NullOr(
  Schema.Number.pipe(Schema.int(), Schema.between(1, SCHEDULED_TASK_MAX_RUNS_LIMIT)),
)

export const scheduledTaskInputSchema: Schema.Schema<ScheduledTaskInput> = Schema.Struct({
  name: taskNameSchema,
  prompt: taskPromptSchema,
  enabled: Schema.Boolean,
  schedule: taskScheduleSchema,
  timeZone: Schema.optional(timeZoneSchema),
  endsAt: Schema.optional(endsAtSchema),
  maxRuns: Schema.optional(maxRunsSchema),
  target: scheduledTaskTargetSchema,
  notificationPolicy: Schema.optional(notificationPolicySchema),
  heartbeat: Schema.optional(heartbeatSettingsInputSchema),
})

export const scheduledTaskPatchSchema: Schema.Schema<ScheduledTaskPatch> = Schema.Struct({
  name: Schema.optional(taskNameSchema),
  prompt: Schema.optional(taskPromptSchema),
  enabled: Schema.optional(Schema.Boolean),
  schedule: Schema.optional(taskScheduleSchema),
  timeZone: Schema.optional(timeZoneSchema),
  endsAt: Schema.optional(endsAtSchema),
  maxRuns: Schema.optional(maxRunsSchema),
  target: Schema.optional(scheduledTaskTargetSchema),
  notificationPolicy: Schema.optional(notificationPolicySchema),
  heartbeat: Schema.optional(heartbeatSettingsInputSchema),
})

const scheduledTasksCommandSchema: Schema.Schema<ScheduledTasksCommand> = Schema.Union(
  Schema.Struct({
    operation: Schema.Literal('list'),
    projectPath: Schema.optional(sessionInputPathSchema),
    sessionId: Schema.optional(sessionInputIdSchema),
  }),
  Schema.Struct({ operation: Schema.Literal('read'), taskId: sessionInputIdSchema }),
  Schema.Struct({
    operation: Schema.Literal('runs'),
    taskId: sessionInputIdSchema,
    limit: Schema.optional(
      Schema.Number.pipe(Schema.int(), Schema.between(1, SCHEDULED_TASK_RUN_PAGE_LIMIT)),
    ),
    before: Schema.optional(timestampSchema),
  }),
  Schema.Struct({ operation: Schema.Literal('create'), input: scheduledTaskInputSchema }),
  Schema.Struct({
    operation: Schema.Literal('update'),
    taskId: sessionInputIdSchema,
    patch: scheduledTaskPatchSchema,
  }),
  Schema.Struct({ operation: Schema.Literal('delete'), taskId: sessionInputIdSchema }),
  Schema.Struct({ operation: Schema.Literal('run-now'), taskId: sessionInputIdSchema }),
  Schema.Struct({
    operation: Schema.Literal('approve-wake-check'),
    taskId: sessionInputIdSchema,
    command: heartbeatWakeCheckCommandSchema,
  }),
  Schema.Struct({
    operation: Schema.Literal('report-outcome'),
    runId: sessionInputIdSchema,
    outcome: heartbeatRunOutcomeSchema,
    note: Schema.optional(heartbeatOutcomeNoteSchema),
  }),
)

export const scheduledTasksRequestSchema: Schema.Schema<ScheduledTasksRequest> = Schema.Struct({
  contractVersion: Schema.Literal(SCHEDULED_TASKS_CONTRACT_VERSION),
  requestId: sessionInputIdSchema,
  idempotencyKey: Schema.optional(sessionInputIdSchema),
  command: scheduledTasksCommandSchema,
})

const scheduledTaskRunSchema: Schema.Schema<ScheduledTaskRun> = Schema.Struct({
  id: Schema.String,
  taskId: Schema.String,
  trigger: Schema.Literal('schedule', 'catch-up', 'run-now'),
  nominalAt: timestampSchema,
  firedAt: timestampSchema,
  missedCount: countSchema,
  status: Schema.Literal(...SCHEDULED_TASK_RUN_STATUSES),
  reason: Schema.optional(Schema.Literal(...SCHEDULED_TASK_RUN_REASONS)),
  message: Schema.optional(Schema.String),
  sessionId: Schema.optional(Schema.String),
  runId: Schema.optional(Schema.String),
  wakeCheck: Schema.optional(scheduledTaskRunWakeCheckSchema),
  outcome: Schema.optional(scheduledTaskRunOutcomeSchema),
})

const scheduledTaskSchema: Schema.Schema<ScheduledTask> = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  prompt: Schema.String,
  kind: Schema.Literal(...SCHEDULED_TASK_KINDS),
  enabled: Schema.Boolean,
  schedule: taskScheduleSchema,
  timeZone: Schema.String,
  endsAt: Schema.NullOr(timestampSchema),
  maxRuns: Schema.NullOr(countSchema),
  target: scheduledTaskTargetSchema,
  notificationPolicy: notificationPolicySchema,
  projectPath: Schema.NullOr(Schema.String),
  creator: Schema.Struct({
    kind: Schema.Literal('local-user', 'profile', 'session-agent'),
    label: Schema.String,
    sessionId: Schema.optional(Schema.String),
  }),
  attention: Schema.NullOr(
    Schema.Struct({
      reason: Schema.Literal(...SCHEDULED_TASK_ATTENTION_REASONS),
      message: Schema.String,
      since: timestampSchema,
    }),
  ),
  nextRunAt: Schema.NullOr(timestampSchema),
  nextNominalAt: Schema.NullOr(timestampSchema),
  waitingSince: Schema.NullOr(timestampSchema),
  runCount: countSchema,
  lastRun: Schema.NullOr(scheduledTaskRunSchema),
  heartbeat: Schema.NullOr(heartbeatSettingsSchema),
  recentSessionIds: Schema.Array(Schema.String),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
})

const scheduledTasksResponseSchema: Schema.Schema<ScheduledTasksResponse> = Schema.Struct({
  contractVersion: Schema.Literal(SCHEDULED_TASKS_CONTRACT_VERSION),
  requestId: Schema.String,
  operation: Schema.Literal(...SCHEDULED_TASKS_OPERATIONS),
  outcome: Schema.Union(
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
    Schema.Struct({
      effect: Schema.Literal('rejected'),
      code: Schema.Literal(...SCHEDULED_TASK_REJECTION_CODES),
      message: Schema.String,
    }),
  ),
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

import type { SchemaType } from '@shared/schema'
import type { localScheduledTasksCommandResultSchema } from '@shared/schemas/local-session-command-response'
import type { localScheduledTasksCommandPayloadSchema } from '@shared/schemas/local-session-protocol'
import type {
  scheduledTaskInputSchema,
  scheduledTaskPatchSchema,
  scheduledTasksCommandSchema,
  scheduledTasksRequestSchema,
} from '@shared/schemas/scheduled-task'
import type {
  scheduledTaskAttentionSchema,
  scheduledTaskCreatorSchema,
  scheduledTaskRunSchema,
  scheduledTaskRunTriggerSchema,
  scheduledTaskSchema,
  scheduledTasksOutcomeSchema,
  scheduledTasksResponseSchema,
} from '@shared/schemas/scheduled-task-records'
import type {
  launchScheduleWorkspaceSchema,
  scheduledTaskTargetSchema,
  taskScheduleSchema,
} from '@shared/schemas/scheduled-task-schedule'

export * from './scheduled-task-heartbeat'

/**
 * Scheduled tasks (ADR 0057, ADR 0058): a saved prompt, Task schedule, and target, owned by one
 * project and private to the user, that the Session Host delivers without a person sending it.
 */
export const SCHEDULED_TASKS_CONTRACT_VERSION = 1 as const

export const SCHEDULED_TASK_KINDS = ['heartbeat', 'launch'] as const
export type ScheduledTaskKind = (typeof SCHEDULED_TASK_KINDS)[number]

/** ISO weekday numbers: 1 is Monday and 7 is Sunday. */
export const ISO_WEEKDAYS = [1, 2, 3, 4, 5, 6, 7] as const
export type IsoWeekday = (typeof ISO_WEEKDAYS)[number]

/** A Heartbeat fires at most every 5 minutes and a Launch schedule at most every 15 (ADR 0057). */
export const HEARTBEAT_MIN_INTERVAL_MINUTES = 5
export const LAUNCH_SCHEDULE_MIN_INTERVAL_MINUTES = 15
export const SCHEDULED_TASK_MAX_INTERVAL_MINUTES = 60 * 24 * 31
export const SCHEDULED_TASK_NAME_MAX_LENGTH = 120
export const SCHEDULED_TASK_PROMPT_MAX_LENGTH = 16_000
export const SCHEDULED_TASK_RRULE_MAX_LENGTH = 512
export const SCHEDULED_TASK_TIME_ZONE_MAX_LENGTH = 64
export const SCHEDULED_TASK_MAX_RUNS_LIMIT = 100_000
export const SCHEDULED_TASK_RUN_PAGE_LIMIT = 100
export const SCHEDULED_TASK_LIST_LIMIT = 500
export const SCHEDULED_TASK_RECENT_SESSION_LIMIT = 50

export type TaskSchedule = SchemaType<typeof taskScheduleSchema>
export type LaunchScheduleWorkspace = SchemaType<typeof launchScheduleWorkspaceSchema>
export type ScheduledTaskTarget = SchemaType<typeof scheduledTaskTargetSchema>

/** Whom a Scheduled task notifies: every run, or only failures and attention. */
export const SCHEDULED_TASK_NOTIFICATION_POLICIES = ['every-run', 'failures-only'] as const
export type ScheduledTaskNotificationPolicy = (typeof SCHEDULED_TASK_NOTIFICATION_POLICIES)[number]

export const SCHEDULED_TASK_ATTENTION_REASONS = [
  'creator-authority-revoked',
  'target-session-archived',
  'target-session-missing',
  'project-missing',
  'model-unavailable',
  'agent-definition-invalid',
  'launch-refused',
] as const
export type ScheduledTaskAttentionReason = (typeof SCHEDULED_TASK_ATTENTION_REASONS)[number]

export type ScheduledTaskAttention = SchemaType<typeof scheduledTaskAttentionSchema>
export type ScheduledTaskCreator = SchemaType<typeof scheduledTaskCreatorSchema>

export const SCHEDULED_TASK_RUN_STATUSES = ['started', 'skipped', 'failed'] as const
export type ScheduledTaskRunStatus = (typeof SCHEDULED_TASK_RUN_STATUSES)[number]

export const SCHEDULED_TASK_RUN_REASONS = [
  'session-busy',
  'previous-run-active',
  'host-capacity-reached',
  'pi-cli-wrote-last',
  'creator-authority-revoked',
  'target-session-archived',
  'target-session-missing',
  'project-missing',
  'model-unavailable',
  'agent-definition-invalid',
  'launch-refused',
  'dispatch-failed',
  'interrupted-by-host-stop',
  'wake-check-idle',
  'wake-check-failed',
  'wake-check-unapproved',
] as const
export type ScheduledTaskRunReason = (typeof SCHEDULED_TASK_RUN_REASONS)[number]

export type ScheduledTaskRunTrigger = SchemaType<typeof scheduledTaskRunTriggerSchema>
export type ScheduledTaskRun = SchemaType<typeof scheduledTaskRunSchema>
export type ScheduledTask = SchemaType<typeof scheduledTaskSchema>
export type ScheduledTaskInput = SchemaType<typeof scheduledTaskInputSchema>
export type ScheduledTaskPatch = SchemaType<typeof scheduledTaskPatchSchema>
export type ScheduledTasksCommand = SchemaType<typeof scheduledTasksCommandSchema>

export const SCHEDULED_TASKS_OPERATIONS = [
  'list',
  'read',
  'runs',
  'create',
  'update',
  'delete',
  'run-now',
  'approve-wake-check',
  'report-outcome',
] as const
export type ScheduledTasksOperation = (typeof SCHEDULED_TASKS_OPERATIONS)[number]

export type ScheduledTasksRequest = SchemaType<typeof scheduledTasksRequestSchema>
export type ScheduledTasksOutcome = SchemaType<typeof scheduledTasksOutcomeSchema>

export {
  SCHEDULED_TASK_REJECTION_CODES,
  type ScheduledTaskRejectionCode,
} from './scheduled-task-rejection'

export type ScheduledTasksResponse = SchemaType<typeof scheduledTasksResponseSchema>

export type LocalScheduledTasksCommandPayload = SchemaType<
  typeof localScheduledTasksCommandPayloadSchema
>
export type LocalScheduledTasksCommandResult = SchemaType<
  typeof localScheduledTasksCommandResultSchema
>

/** The enabled tasks `openwaggle host status` reports, so a windowless Host is never invisible. */
export interface ScheduledTaskStatusSummary {
  readonly id: string
  readonly name: string
  readonly kind: ScheduledTaskKind
  readonly nextRunAt: number | null
  /** Whether `nextRunAt` may be up to ±5 minutes off the schedule (hourly or slower, ADR 0057). */
  readonly jittered: boolean
}

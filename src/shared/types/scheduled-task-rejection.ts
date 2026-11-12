import type { SchemaType } from '@shared/schema'
import type { scheduledTasksRejectedOutcomeSchema } from '@shared/schemas/scheduled-task-records'

export const SCHEDULED_TASK_REJECTION_CODES = [
  'task_not_found',
  'invalid_schedule',
  'invalid_time_zone',
  'invalid_target',
  'target_not_found',
  'kind_change_not_allowed',
  'target_session_change_not_allowed',
  'creator_identity_unsupported',
  'capability_denied',
  'target_scope_denied',
  'task_limit_reached',
  'run_already_in_progress',
  'scheduler_unavailable',
  'schedule_ended',
  'stop_condition_required',
  'heartbeat_only',
  'wake_check_changed',
  'run_not_scheduled',
] as const
export type ScheduledTaskRejectionCode = (typeof SCHEDULED_TASK_REJECTION_CODES)[number]

export type ScheduledTasksRejectedOutcome = SchemaType<typeof scheduledTasksRejectedOutcomeSchema>

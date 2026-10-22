import type { ThinkingLevel } from './settings'

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

/** When a Scheduled task fires (CONTEXT.md: Task schedule). */
export type TaskSchedule =
  | { readonly kind: 'interval'; readonly everyMinutes: number }
  | {
      readonly kind: 'daily'
      /** Local wall-clock time `HH:MM` in the task's time zone. */
      readonly at: string
      /** Omitted means every day. */
      readonly weekdays?: readonly IsoWeekday[]
    }
  | {
      readonly kind: 'rrule'
      /** An RFC 5545 recurrence rule without DTSTART, UNTIL or COUNT, read in the task's zone. */
      readonly rule: string
    }

export type LaunchScheduleWorkspace = 'new-worktree' | 'local'

export type ScheduledTaskTarget =
  | { readonly kind: 'heartbeat'; readonly sessionId: string }
  | {
      readonly kind: 'launch'
      readonly projectPath: string
      readonly workspace: LaunchScheduleWorkspace
      readonly modelId?: string
      readonly thinkingLevel?: ThinkingLevel
      readonly agentDefinitionName?: string
      /** Archive a launched Session once it finished, nothing needs attention, and no one touched it. */
      readonly archiveFinishedSessions: boolean
    }

/** Whom a Scheduled task notifies: every run, or only failures and attention. */
export type ScheduledTaskNotificationPolicy = 'every-run' | 'failures-only'

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

export interface ScheduledTaskAttention {
  readonly reason: ScheduledTaskAttentionReason
  readonly message: string
  readonly since: number
}

/** Who created a Scheduled task, for display; its authority is revalidated at every run. */
export interface ScheduledTaskCreator {
  readonly kind: 'local-user' | 'profile' | 'session-agent'
  readonly label: string
  readonly sessionId?: string
}

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
] as const
export type ScheduledTaskRunReason = (typeof SCHEDULED_TASK_RUN_REASONS)[number]

export type ScheduledTaskRunTrigger = 'schedule' | 'catch-up' | 'run-now'

/** One firing of a Scheduled task (CONTEXT.md: Scheduled task run). */
export interface ScheduledTaskRun {
  readonly id: string
  readonly taskId: string
  readonly trigger: ScheduledTaskRunTrigger
  /** The fire time the Task schedule named; for a catch-up, the latest one it covers. */
  readonly nominalAt: number
  readonly firedAt: number
  /** Firings missed while the Host was down or the machine slept, covered by this one run. */
  readonly missedCount: number
  readonly status: ScheduledTaskRunStatus
  readonly reason?: ScheduledTaskRunReason
  readonly message?: string
  /** The Session the run delivered into (Heartbeat) or launched (Launch schedule). */
  readonly sessionId?: string
  readonly runId?: string
}

export interface ScheduledTask {
  readonly id: string
  readonly name: string
  readonly prompt: string
  readonly kind: ScheduledTaskKind
  readonly enabled: boolean
  readonly schedule: TaskSchedule
  /** IANA time zone the schedule is read in, stored when the task was created. */
  readonly timeZone: string
  readonly endsAt: number | null
  readonly maxRuns: number | null
  readonly target: ScheduledTaskTarget
  readonly notificationPolicy: ScheduledTaskNotificationPolicy
  /** The project the task belongs to: the Heartbeat target's or the Launch schedule's. */
  readonly projectPath: string | null
  readonly creator: ScheduledTaskCreator
  readonly attention: ScheduledTaskAttention | null
  /** Next fire time, jitter included; null while disabled or once the schedule has ended. */
  readonly nextRunAt: number | null
  /** The nominal time of the next firing, which the history shows beside the actual time. */
  readonly nextNominalAt: number | null
  /** A Heartbeat waiting for its Session to become idle since this time. */
  readonly waitingSince: number | null
  readonly runCount: number
  readonly lastRun: ScheduledTaskRun | null
  /** Sessions this task's recent runs started or delivered into, newest first. */
  readonly recentSessionIds: readonly string[]
  readonly createdAt: number
  readonly updatedAt: number
}

/** What a caller sets when creating a Scheduled task. */
export interface ScheduledTaskInput {
  readonly name: string
  readonly prompt: string
  readonly enabled: boolean
  readonly schedule: TaskSchedule
  /** Omitted: the machine's time zone. */
  readonly timeZone?: string
  readonly endsAt?: number | null
  readonly maxRuns?: number | null
  readonly target: ScheduledTaskTarget
  /** Omitted: failures only for a Heartbeat, every run for a Launch schedule. */
  readonly notificationPolicy?: ScheduledTaskNotificationPolicy
}

/** A partial update; the kind and Heartbeat target Session cannot change. */
export interface ScheduledTaskPatch {
  readonly name?: string
  readonly prompt?: string
  readonly enabled?: boolean
  readonly schedule?: TaskSchedule
  readonly timeZone?: string
  readonly endsAt?: number | null
  readonly maxRuns?: number | null
  readonly target?: ScheduledTaskTarget
  readonly notificationPolicy?: ScheduledTaskNotificationPolicy
}

export type ScheduledTasksCommand =
  | {
      readonly operation: 'list'
      readonly projectPath?: string
      readonly sessionId?: string
    }
  | { readonly operation: 'read'; readonly taskId: string }
  | {
      readonly operation: 'runs'
      readonly taskId: string
      readonly limit?: number
      /** Runs fired before this time. */
      readonly before?: number
    }
  | { readonly operation: 'create'; readonly input: ScheduledTaskInput }
  | { readonly operation: 'update'; readonly taskId: string; readonly patch: ScheduledTaskPatch }
  | { readonly operation: 'delete'; readonly taskId: string }
  | { readonly operation: 'run-now'; readonly taskId: string }

export const SCHEDULED_TASKS_OPERATIONS = [
  'list',
  'read',
  'runs',
  'create',
  'update',
  'delete',
  'run-now',
] as const
export type ScheduledTasksOperation = (typeof SCHEDULED_TASKS_OPERATIONS)[number]

export interface ScheduledTasksRequest {
  readonly contractVersion: typeof SCHEDULED_TASKS_CONTRACT_VERSION
  readonly requestId: string
  readonly idempotencyKey?: string
  readonly command: ScheduledTasksCommand
}

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
] as const
export type ScheduledTaskRejectionCode = (typeof SCHEDULED_TASK_REJECTION_CODES)[number]

export type ScheduledTasksOutcome =
  | { readonly effect: 'listed'; readonly tasks: readonly ScheduledTask[] }
  | {
      readonly effect: 'read'
      readonly task: ScheduledTask
      readonly runs: readonly ScheduledTaskRun[]
    }
  | { readonly effect: 'runs-listed'; readonly runs: readonly ScheduledTaskRun[] }
  | { readonly effect: 'created'; readonly task: ScheduledTask }
  | { readonly effect: 'updated'; readonly task: ScheduledTask }
  | { readonly effect: 'deleted'; readonly taskId: string }
  | { readonly effect: 'run-requested'; readonly task: ScheduledTask }
  | {
      readonly effect: 'rejected'
      readonly code: ScheduledTaskRejectionCode
      readonly message: string
    }

export interface ScheduledTasksResponse {
  readonly contractVersion: typeof SCHEDULED_TASKS_CONTRACT_VERSION
  readonly requestId: string
  readonly operation: ScheduledTasksOperation
  readonly outcome: ScheduledTasksOutcome
}

export type LocalScheduledTasksCommandPayload = {
  readonly contract: 'scheduled-tasks-v1'
  readonly request: ScheduledTasksRequest
}

export type LocalScheduledTasksCommandResult = {
  readonly contract: 'scheduled-tasks-v1'
  readonly response: ScheduledTasksResponse
}

/** The enabled tasks `openwaggle host status` reports, so a windowless Host is never invisible. */
export interface ScheduledTaskStatusSummary {
  readonly id: string
  readonly name: string
  readonly kind: ScheduledTaskKind
  readonly nextRunAt: number | null
}

import type { ConversationId, OrchestrationRunId, OrchestrationTaskId } from './brand'
import type { JsonObject, JsonValue } from './json'

export interface OrchestrationTextOutput {
  readonly [key: string]: JsonValue
  readonly text: string
}

export type OrchestrationOutputValue = JsonValue | OrchestrationTextOutput

export const ORCHESTRATION_TASK_STATUSES = [
  'queued',
  'running',
  'retrying',
  'completed',
  'failed',
  'cancelled',
] as const
export type OrchestrationTaskStatus = (typeof ORCHESTRATION_TASK_STATUSES)[number]

export const ORCHESTRATION_RUN_STATUSES = ['running', 'completed', 'failed', 'cancelled'] as const
export type OrchestrationRunStatus = (typeof ORCHESTRATION_RUN_STATUSES)[number]

export interface OrchestrationTaskAttempt {
  readonly attempt: number
  readonly status: 'ok' | 'error' | 'cancelled'
  readonly errorCode?: string
  readonly error?: string
  readonly startedAt: string
  readonly finishedAt: string
  readonly durationMs: number
}

export interface OrchestrationTaskRetryPolicy {
  readonly retries: number
  readonly backoffMs: number
  readonly jitterMs: number
}

export interface OrchestrationTaskRecord {
  readonly id: OrchestrationTaskId
  readonly kind: string
  readonly status: OrchestrationTaskStatus
  readonly dependsOn: readonly OrchestrationTaskId[]
  readonly title?: string
  readonly startedAt?: string
  readonly finishedAt?: string
  readonly errorCode?: string
  readonly error?: string
  readonly retry?: OrchestrationTaskRetryPolicy
  readonly attempts?: readonly OrchestrationTaskAttempt[]
  readonly createdOrder?: number
}

export interface OrchestrationRunRecord {
  readonly runId: OrchestrationRunId
  readonly conversationId: ConversationId
  readonly status: OrchestrationRunStatus
  readonly startedAt: string
  readonly finishedAt?: string
  readonly maxParallelTasks?: number
  readonly taskOrder: readonly OrchestrationTaskId[]
  readonly tasks: Readonly<Record<string, OrchestrationTaskRecord>>
  readonly outputs: Readonly<{ [taskId: string]: OrchestrationOutputValue }>
  readonly fallbackUsed: boolean
  readonly fallbackReason?: string
  readonly updatedAt: number
}

export type OrchestrationLifecycleEventType =
  | 'run_started'
  | 'task_queued'
  | 'task_started'
  | 'task_progress'
  | 'task_retried'
  | 'task_succeeded'
  | 'task_failed'
  | 'run_completed'
  | 'run_failed'
  | 'run_cancelled'
  | 'fallback'

export interface TaskToolProgressDetail {
  readonly type: 'tool_start' | 'tool_end'
  readonly toolName: string
  readonly toolCallId: string
  readonly toolInput?: Readonly<JsonObject>
}

export interface OrchestrationEventPayload {
  readonly conversationId: ConversationId
  readonly runId: OrchestrationRunId
  readonly type: OrchestrationLifecycleEventType
  readonly at: string
  readonly taskId?: OrchestrationTaskId
  readonly taskKind?: string
  readonly message?: string
  readonly detail?: OrchestrationEventDetail
}

export type OrchestrationEventDetail =
  | {
      readonly type: 'run_started'
      readonly runId: string
      readonly at: string
    }
  | {
      readonly type: 'task_queued'
      readonly runId: string
      readonly taskId: string
      readonly at: string
    }
  | {
      readonly type: 'task_started'
      readonly runId: string
      readonly taskId: string
      readonly attempt: number
      readonly at: string
    }
  | {
      readonly type: 'task_progress'
      readonly runId: string
      readonly taskId: string
      readonly at: string
      readonly payload: TaskToolProgressDetail | JsonValue
    }
  | {
      readonly type: 'task_retried'
      readonly runId: string
      readonly taskId: string
      readonly attempt: number
      readonly nextAttempt: number
      readonly delayMs: number
      readonly at: string
      readonly errorCode?: string
      readonly error?: string
    }
  | {
      readonly type: 'task_succeeded'
      readonly runId: string
      readonly taskId: string
      readonly attempt: number
      readonly at: string
      readonly output?: OrchestrationOutputValue
    }
  | {
      readonly type: 'task_failed'
      readonly runId: string
      readonly taskId: string
      readonly attempt: number
      readonly at: string
      readonly errorCode?: string
      readonly error?: string
    }
  | {
      readonly type: 'run_completed'
      readonly runId: string
      readonly at: string
    }
  | {
      readonly type: 'run_failed'
      readonly runId: string
      readonly at: string
      readonly error?: string
    }
  | {
      readonly type: 'run_cancelled'
      readonly runId: string
      readonly at: string
      readonly reason?: string
    }

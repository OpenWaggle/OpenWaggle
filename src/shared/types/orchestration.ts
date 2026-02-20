import type { ConversationId, OrchestrationRunId, OrchestrationTaskId } from './brand'

export type OrchestrationTaskStatus =
  | 'queued'
  | 'running'
  | 'retrying'
  | 'completed'
  | 'failed'
  | 'cancelled'

export type OrchestrationRunStatus = 'running' | 'completed' | 'failed' | 'cancelled'

export interface OrchestrationTaskRecord {
  readonly id: OrchestrationTaskId
  readonly kind: string
  readonly status: OrchestrationTaskStatus
  readonly dependsOn: readonly OrchestrationTaskId[]
  readonly startedAt?: string
  readonly finishedAt?: string
  readonly errorCode?: string
  readonly error?: string
}

export interface OrchestrationRunRecord {
  readonly runId: OrchestrationRunId
  readonly conversationId: ConversationId
  readonly status: OrchestrationRunStatus
  readonly startedAt: string
  readonly finishedAt?: string
  readonly taskOrder: readonly OrchestrationTaskId[]
  readonly tasks: Readonly<Record<string, OrchestrationTaskRecord>>
  readonly outputs: Readonly<Record<string, unknown>>
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

export interface OrchestrationEventPayload {
  readonly conversationId: ConversationId
  readonly runId: OrchestrationRunId
  readonly type: OrchestrationLifecycleEventType
  readonly at: string
  readonly taskId?: OrchestrationTaskId
  readonly message?: string
  readonly detail?: unknown
}

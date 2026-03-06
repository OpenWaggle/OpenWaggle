import type { JsonObject, JsonValue } from '@shared/types/json'

// --- Core orchestration types ---

export const ORCHESTRATION_ERROR_TASK_TIMEOUT = 'TASK_TIMEOUT'
export const ORCHESTRATION_ERROR_TASK_EXECUTION = 'TASK_EXECUTION_FAILURE'
export const ORCHESTRATION_ERROR_TASK_CANCELLED = 'TASK_CANCELLED'

export type OrchestrationTaskOutputValue = JsonValue | OpenWaggleTaskOutput

export type OrchestrationProgressPayload = JsonValue | OpenWaggleProgressPayload

export interface OrchestrationTaskRetryPolicy {
  readonly retries?: number
  readonly backoffMs?: number
  readonly jitterMs?: number
}

export interface OrchestrationTaskDefinition {
  readonly id: string
  readonly kind: string
  readonly input?: JsonValue
  readonly dependsOn?: readonly string[]
  readonly retry?: OrchestrationTaskRetryPolicy
  readonly timeoutMs?: number
  readonly metadata?: Readonly<JsonObject>
}

export type OrchestrationTaskStatus =
  | 'queued'
  | 'running'
  | 'retrying'
  | 'completed'
  | 'failed'
  | 'cancelled'

export interface OrchestrationTaskAttempt {
  readonly attempt: number
  readonly status: 'ok' | 'error' | 'cancelled'
  readonly errorCode?: string
  readonly error?: string
  readonly startedAt: string
  readonly finishedAt: string
  readonly durationMs: number
}

export interface OrchestrationTaskRecord {
  readonly id: string
  readonly kind: string
  readonly dependsOn: readonly string[]
  readonly input?: JsonValue
  readonly output?: OrchestrationTaskOutputValue
  readonly status: OrchestrationTaskStatus
  readonly retry: Required<OrchestrationTaskRetryPolicy>
  readonly timeoutMs?: number
  readonly attempts: readonly OrchestrationTaskAttempt[]
  readonly startedAt?: string
  readonly finishedAt?: string
  readonly errorCode?: string
  readonly error?: string
  readonly metadata?: Readonly<JsonObject>
  readonly createdOrder: number
}

export type OrchestrationRunStatus = 'running' | 'completed' | 'failed' | 'cancelled'

export interface OrchestrationRunRecord {
  readonly runId: string
  readonly status: OrchestrationRunStatus
  readonly startedAt: string
  readonly finishedAt?: string
  readonly maxParallelTasks?: number
  readonly tasks: Readonly<Record<string, OrchestrationTaskRecord>>
  readonly taskOrder: readonly string[]
  readonly outputs: Readonly<{ [taskId: string]: OrchestrationTaskOutputValue }>
  readonly summary: {
    readonly total: number
    readonly completed: number
    readonly failed: number
    readonly cancelled: number
    readonly queued: number
    readonly running: number
    readonly retrying: number
  }
}

export type OrchestrationEvent =
  | { readonly type: 'run_started'; readonly runId: string; readonly at: string }
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
      readonly payload: OrchestrationProgressPayload
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
      readonly output?: OrchestrationTaskOutputValue
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
  | { readonly type: 'run_completed'; readonly runId: string; readonly at: string }
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

export interface OrchestrationTaskContext {
  readonly runId: string
  readonly signal: AbortSignal
  readonly dependencyOutputs: Readonly<{ [taskId: string]: OrchestrationTaskOutputValue }>
  reportProgress: (payload: OrchestrationProgressPayload) => void
  spawn: (task: OrchestrationTaskDefinition) => Promise<void>
}

export interface WorkerAdapter {
  executeTask(
    task: OrchestrationTaskDefinition,
    context: OrchestrationTaskContext,
  ): Promise<{ readonly output?: OrchestrationTaskOutputValue }>
}

export interface RunStore {
  saveRun(run: OrchestrationRunRecord): Promise<void>
  getRun(runId: string): Promise<OrchestrationRunRecord | null>
  listRuns(): Promise<readonly OrchestrationRunRecord[]>
}

export interface OrchestrationRunDefinition {
  readonly runId?: string
  readonly tasks: readonly OrchestrationTaskDefinition[]
  readonly maxParallelTasks?: number
  readonly signal?: AbortSignal
}

export interface RunSummary {
  readonly runId: string
  readonly status: OrchestrationRunStatus
  readonly outputs: Readonly<{ [taskId: string]: OrchestrationTaskOutputValue }>
  readonly failedTaskIds: readonly string[]
  readonly cancelledTaskIds: readonly string[]
}

export interface OrchestrationEngine {
  run(definition: OrchestrationRunDefinition): Promise<RunSummary>
  resume(runId: string): Promise<RunSummary>
  cancel(runId: string, reason?: string): Promise<void>
  getRun(runId: string): Promise<OrchestrationRunRecord | null>
  listRuns(): Promise<readonly OrchestrationRunRecord[]>
}

// --- OpenWaggle-specific orchestration types ---

export type OpenWaggleTaskKind = 'analysis' | 'synthesis' | 'repo-edit' | 'general'

export interface OpenWaggleChildContextOptions {
  readonly taskKind?: OpenWaggleTaskKind
  readonly needsConversationContext?: boolean
  readonly maxContextTokens?: number
}

export interface OpenWagglePlannedTask {
  readonly id: string
  readonly kind: OpenWaggleTaskKind
  readonly title: string
  readonly prompt: string
  readonly narration?: string
  readonly dependsOn?: readonly string[]
  readonly needsConversationContext?: boolean
}

export interface OpenWaggleOrchestrationPlan {
  readonly tasks: readonly OpenWagglePlannedTask[]
}

export interface OpenWagglePlannerInput {
  readonly userPrompt: string
}

export interface OpenWagglePlanner {
  plan(input: OpenWagglePlannerInput): Promise<JsonValue>
}

export interface OpenWaggleProgressPayload {
  readonly type: 'tool_start' | 'tool_end'
  readonly toolName: string
  readonly toolCallId: string
  readonly toolInput?: Readonly<JsonObject>
}

export interface OpenWaggleTaskOutput {
  readonly [key: string]: JsonValue
  readonly text: string
}

export interface OpenWaggleTaskExecutionInput {
  readonly task: OpenWagglePlannedTask
  readonly orchestrationTask: OrchestrationTaskDefinition
  readonly includeConversationSummary: boolean
  readonly maxContextTokens: number
  readonly dependencyOutputs: Readonly<{ [taskId: string]: OrchestrationTaskOutputValue }>
  readonly signal: AbortSignal
  readonly reportProgress?: (payload: OpenWaggleProgressPayload) => void
}

export interface OpenWaggleTaskExecutor {
  execute(input: OpenWaggleTaskExecutionInput): Promise<OpenWaggleTaskOutput>
}

export interface OpenWaggleSynthesizerInput {
  readonly userPrompt: string
  readonly plan: OpenWaggleOrchestrationPlan
  readonly run: OrchestrationRunRecord
}

export interface OpenWaggleSynthesizer {
  synthesize(input: OpenWaggleSynthesizerInput): Promise<string>
}

export interface RunOpenWaggleOrchestrationInput {
  readonly runId?: string
  readonly userPrompt: string
  readonly planner: OpenWagglePlanner
  readonly executor: OpenWaggleTaskExecutor
  readonly synthesizer: OpenWaggleSynthesizer
  readonly signal?: AbortSignal
  readonly maxParallelTasks?: number
  readonly maxContextTokens?: number
  readonly runStore?: RunStore
  readonly onEvent?: (event: OrchestrationEvent) => void | Promise<void>
}

export interface OpenWaggleOrchestrationResult {
  readonly runId: string
  readonly usedFallback: boolean
  readonly fallbackReason?: string
  readonly text: string
  readonly runStatus?: 'running' | 'completed' | 'failed' | 'cancelled'
  readonly run?: OrchestrationRunRecord
}

// --- Core orchestration types ---

export const ORCHESTRATION_ERROR_TASK_TIMEOUT = 'TASK_TIMEOUT'
export const ORCHESTRATION_ERROR_TASK_EXECUTION = 'TASK_EXECUTION_FAILURE'
export const ORCHESTRATION_ERROR_TASK_CANCELLED = 'TASK_CANCELLED'

export interface OrchestrationTaskRetryPolicy {
  readonly retries?: number
  readonly backoffMs?: number
  readonly jitterMs?: number
}

export interface OrchestrationTaskDefinition {
  readonly id: string
  readonly kind: string
  readonly input?: unknown
  readonly dependsOn?: readonly string[]
  readonly retry?: OrchestrationTaskRetryPolicy
  readonly timeoutMs?: number
  readonly metadata?: Readonly<Record<string, unknown>>
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
  readonly input?: unknown
  readonly output?: unknown
  readonly status: OrchestrationTaskStatus
  readonly retry: Required<OrchestrationTaskRetryPolicy>
  readonly timeoutMs?: number
  readonly attempts: readonly OrchestrationTaskAttempt[]
  readonly startedAt?: string
  readonly finishedAt?: string
  readonly errorCode?: string
  readonly error?: string
  readonly metadata?: Readonly<Record<string, unknown>>
  readonly createdOrder: number
}

export type OrchestrationRunStatus = 'running' | 'completed' | 'failed' | 'cancelled'

export interface OrchestrationRunRecord {
  readonly runId: string
  readonly status: OrchestrationRunStatus
  readonly startedAt: string
  readonly finishedAt?: string
  readonly tasks: Readonly<Record<string, OrchestrationTaskRecord>>
  readonly taskOrder: readonly string[]
  readonly outputs: Readonly<Record<string, unknown>>
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
      readonly payload: unknown
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
      readonly output?: unknown
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
  readonly dependencyOutputs: Readonly<Record<string, unknown>>
  reportProgress: (payload: unknown) => void
  spawn: (task: OrchestrationTaskDefinition) => Promise<void>
}

export interface WorkerAdapter {
  executeTask(
    task: OrchestrationTaskDefinition,
    context: OrchestrationTaskContext,
  ): Promise<{ readonly output?: unknown }>
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
  readonly outputs: Readonly<Record<string, unknown>>
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

// --- OpenHive-specific orchestration types ---

export type OpenHiveTaskKind = 'analysis' | 'synthesis' | 'repo-edit' | 'general'

export interface OpenHiveChildContextOptions {
  readonly taskKind?: OpenHiveTaskKind
  readonly needsConversationContext?: boolean
  readonly maxContextTokens?: number
}

export interface OpenHivePlannedTask {
  readonly id: string
  readonly kind: OpenHiveTaskKind
  readonly title: string
  readonly prompt: string
  readonly narration?: string
  readonly dependsOn?: readonly string[]
  readonly needsConversationContext?: boolean
}

export interface OpenHiveOrchestrationPlan {
  readonly tasks: readonly OpenHivePlannedTask[]
}

export interface OpenHivePlannerInput {
  readonly userPrompt: string
}

export interface OpenHivePlanner {
  plan(input: OpenHivePlannerInput): Promise<unknown>
}

export interface OpenHiveProgressPayload {
  readonly type: 'tool_start' | 'tool_end'
  readonly toolName: string
  readonly toolCallId: string
  readonly toolInput?: Readonly<Record<string, unknown>>
}

export interface OpenHiveTaskOutput {
  readonly text: string
}

export interface OpenHiveTaskExecutionInput {
  readonly task: OpenHivePlannedTask
  readonly orchestrationTask: OrchestrationTaskDefinition
  readonly includeConversationSummary: boolean
  readonly maxContextTokens: number
  readonly dependencyOutputs: Readonly<Record<string, unknown>>
  readonly signal: AbortSignal
  readonly reportProgress?: (payload: OpenHiveProgressPayload) => void
}

export interface OpenHiveTaskExecutor {
  execute(input: OpenHiveTaskExecutionInput): Promise<OpenHiveTaskOutput>
}

export interface OpenHiveSynthesizerInput {
  readonly userPrompt: string
  readonly plan: OpenHiveOrchestrationPlan
  readonly run: OrchestrationRunRecord
}

export interface OpenHiveSynthesizer {
  synthesize(input: OpenHiveSynthesizerInput): Promise<string>
}

export interface RunOpenHiveOrchestrationInput {
  readonly runId?: string
  readonly userPrompt: string
  readonly planner: OpenHivePlanner
  readonly executor: OpenHiveTaskExecutor
  readonly synthesizer: OpenHiveSynthesizer
  readonly signal?: AbortSignal
  readonly maxParallelTasks?: number
  readonly maxContextTokens?: number
  readonly runStore?: RunStore
  readonly onEvent?: (event: OrchestrationEvent) => void | Promise<void>
  readonly mode?: 'orchestrated' | 'auto-fallback'
}

export interface OpenHiveOrchestrationResult {
  readonly runId: string
  readonly usedFallback: boolean
  readonly fallbackReason?: string
  readonly text: string
  readonly runStatus?: 'running' | 'completed' | 'failed' | 'cancelled'
  readonly run?: OrchestrationRunRecord
}

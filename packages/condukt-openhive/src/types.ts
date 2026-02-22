import type {
  OrchestrationEvent,
  OrchestrationRunRecord,
  OrchestrationTaskDefinition,
  RunStore,
} from 'condukt-ai'

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

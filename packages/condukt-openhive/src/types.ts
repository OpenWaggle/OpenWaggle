import type { OrchestrationEvent, OrchestrationRunRecord, OrchestrationTaskDefinition } from "../../condukt-ai/src/index.js"

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

export interface OpenHiveTaskExecutionInput {
  readonly task: OpenHivePlannedTask
  readonly orchestrationTask: OrchestrationTaskDefinition
  readonly includeConversationSummary: boolean
  readonly maxContextTokens: number
  readonly dependencyOutputs: Readonly<Record<string, unknown>>
  readonly signal: AbortSignal
}

export interface OpenHiveTaskExecutor {
  execute(input: OpenHiveTaskExecutionInput): Promise<unknown>
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

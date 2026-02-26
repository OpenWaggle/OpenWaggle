import type { AgentSendPayload, Message } from '@shared/types/agent'
import type { ConversationId } from '@shared/types/brand'
import type { Conversation } from '@shared/types/conversation'
import type { JsonObject, JsonValue } from '@shared/types/json'
import type { SupportedModelId } from '@shared/types/llm'
import type { OrchestrationEventPayload } from '@shared/types/orchestration'
import type { Settings } from '@shared/types/settings'
import type { AnyTextAdapter, maxIterations, ServerTool, StreamChunk } from '@tanstack/ai'
import type { isReasoningModel } from '../../agent/quality-config'
import type {
  buildPersistedUserMessageParts,
  buildSamplingOptions,
  isResolutionError,
  makeMessage,
  resolveProviderAndQuality,
} from '../../agent/shared'
import type { loadProjectConfig } from '../../config/project-config'
import type { Logger } from '../../logger'
import type { extractJson, OpenWaggleProgressPayload, runOpenWaggleOrchestration } from '../engine'
import type { createExecutorTools, gatherProjectContext } from '../project-context'
import type { OrchestrationRunRepository } from '../run-repository'

export interface OrchestratedAgentRunParams {
  readonly runId: string
  readonly conversationId: ConversationId
  readonly conversation: Conversation
  readonly payload: AgentSendPayload
  readonly model: SupportedModelId
  readonly settings: Settings
  readonly signal: AbortSignal
  readonly emitEvent: (payload: OrchestrationEventPayload) => void
  readonly emitChunk: (chunk: StreamChunk) => void
}

export interface OrchestratedAgentRunResult {
  readonly status: 'completed' | 'failed' | 'cancelled' | 'fallback'
  readonly runId: string
  readonly newMessages?: readonly Message[]
  readonly reason?: string
}

export interface SamplingConfig {
  readonly temperature?: number
  readonly topP?: number
  readonly maxTokens: number
  readonly modelOptions?: JsonObject
}

export interface FallbackState {
  used: boolean
  reason: string | undefined
}

export interface ModelRunner {
  modelText(
    adapter: AnyTextAdapter,
    prompt: string,
    quality: SamplingConfig,
    onChunk?: (chunk: StreamChunk) => void,
  ): Promise<string>
  modelTextWithTools(
    adapter: AnyTextAdapter,
    prompt: string,
    quality: SamplingConfig,
    tools: ServerTool[],
    reportProgress?: (payload: OpenWaggleProgressPayload) => void,
    onChunk?: (chunk: StreamChunk) => void,
  ): Promise<string>
  modelJson(
    adapter: AnyTextAdapter,
    prompt: string,
    quality: SamplingConfig,
    onChunk?: (chunk: StreamChunk) => void,
  ): Promise<JsonValue>
}

export interface ChatRunOptions {
  readonly adapter: AnyTextAdapter
  readonly stream: true
  readonly messages: Array<{ readonly role: 'user'; readonly content: string }>
  readonly tools?: ServerTool[]
  readonly temperature?: number
  readonly topP?: number
  readonly maxTokens?: number
  readonly modelOptions?: JsonObject
  readonly agentLoopStrategy?: ReturnType<typeof maxIterations>
}

export type ChatRunner = (options: ChatRunOptions) => AsyncIterable<StreamChunk>

export interface OrchestrationServiceDeps {
  readonly now: () => number
  readonly sleep: (delayMs: number) => Promise<void>
  readonly randomId: () => string
  readonly logger: Logger
  readonly streamChunkSize: number
  readonly streamChunkDelayMs: number
  readonly loadProjectConfig: typeof loadProjectConfig
  readonly resolveProviderAndQuality: typeof resolveProviderAndQuality
  readonly isResolutionError: typeof isResolutionError
  readonly isReasoningModel: typeof isReasoningModel
  readonly buildPersistedUserMessageParts: typeof buildPersistedUserMessageParts
  readonly buildSamplingOptions: typeof buildSamplingOptions
  readonly makeMessage: typeof makeMessage
  readonly gatherProjectContext: typeof gatherProjectContext
  readonly createExecutorTools: typeof createExecutorTools
  readonly runOpenWaggleOrchestration: typeof runOpenWaggleOrchestration
  readonly extractJson: typeof extractJson
  readonly chat: ChatRunner
  readonly maxIterations: typeof maxIterations
  readonly runRepository: Pick<OrchestrationRunRepository, 'createRunStore'>
}

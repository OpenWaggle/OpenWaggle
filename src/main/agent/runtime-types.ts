import type { Conversation } from '@shared/types/conversation'
import type { SupportedModelId } from '@shared/types/llm'
import type { ProviderConfig, Settings } from '@shared/types/settings'
import type { ServerTool, StreamChunk } from '@tanstack/ai'
import type { AgentStandardsContext } from './standards-context'
import type { ProviderDefinition } from '../providers/provider-definition'

export interface AgentRunContext {
  readonly runId: string
  readonly conversation: Conversation
  readonly model: SupportedModelId
  readonly settings: Settings
  readonly signal: AbortSignal
  readonly projectPath: string
  readonly hasProject: boolean
  readonly provider: ProviderDefinition
  readonly providerConfig: ProviderConfig
  readonly standards?: AgentStandardsContext
}

export interface AgentPromptFragment {
  readonly id: string
  readonly order: number
  build: (context: AgentRunContext) => string | null
}

export interface AgentToolCallStartEvent {
  readonly toolCallId: string
  readonly toolName: string
  readonly startedAt: number
}

export interface AgentToolCallEndEvent {
  readonly toolCallId: string
  readonly toolName: string
  readonly args: Readonly<Record<string, unknown>>
  readonly result?: string
  readonly durationMs: number
  readonly isError: boolean
}

export interface AgentRunSummary {
  readonly promptFragmentIds: readonly string[]
  readonly stageDurationsMs: Readonly<Record<string, number>>
  readonly toolCalls: number
  readonly toolErrors: number
  readonly selectedSkillIds?: readonly string[]
  readonly standardsWarnings?: readonly string[]
}

export interface AgentLifecycleHook {
  readonly id: string
  onRunStart?: (context: AgentRunContext) => void | Promise<void>
  onStreamChunk?: (context: AgentRunContext, chunk: StreamChunk) => void | Promise<void>
  onToolCallStart?: (
    context: AgentRunContext,
    event: AgentToolCallStartEvent,
  ) => void | Promise<void>
  onToolCallEnd?: (context: AgentRunContext, event: AgentToolCallEndEvent) => void | Promise<void>
  onRunError?: (context: AgentRunContext, error: Error) => void | Promise<void>
  onRunComplete?: (context: AgentRunContext, summary: AgentRunSummary) => void | Promise<void>
}

export interface AgentFeature {
  readonly id: string
  isEnabled?: (context: AgentRunContext) => boolean
  getPromptFragments?: (context: AgentRunContext) => readonly AgentPromptFragment[]
  getTools?: (context: AgentRunContext) => readonly ServerTool[]
  filterTools?: (tools: readonly ServerTool[], context: AgentRunContext) => readonly ServerTool[]
  getLifecycleHooks?: (context: AgentRunContext) => readonly AgentLifecycleHook[]
}

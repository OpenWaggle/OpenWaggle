import type { Conversation } from '@shared/types/conversation'
import type { JsonObject } from '@shared/types/json'
import type { SupportedModelId } from '@shared/types/llm'
import type { ProviderConfig, Settings } from '@shared/types/settings'
import type { AgentStreamChunk } from '@shared/types/stream'
import type { AgentToolFilter, SubAgentContext } from '@shared/types/sub-agent'
import type { ToolApprovalConfig } from '@shared/types/tool-approval'
import type { DomainServerTool } from '../ports/tool-types'
import type { ProviderDefinition } from '../providers/provider-definition'
import type { AgentStandardsContext } from './standards-context'

/** Extends the shared SubAgentContext with agent-loop-specific fields */
export type SubAgentRunContext = SubAgentContext & {
  readonly agentType: string
  readonly toolFilter: AgentToolFilter
}

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
  readonly toolApprovals?: ToolApprovalConfig
  readonly standards?: AgentStandardsContext
  readonly planModeRequested?: boolean
  readonly subAgentContext?: SubAgentRunContext
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
  readonly args: Readonly<JsonObject>
  readonly result?: string
  readonly durationMs: number
  readonly isError: boolean
  readonly completionState: 'input-complete' | 'execution-complete'
}

export interface AgentRunSummary {
  readonly promptFragmentIds: readonly string[]
  readonly stageDurationsMs: Readonly<Record<string, number>>
  readonly toolCalls: number
  readonly toolErrors: number
  readonly selectedSkillIds?: readonly string[]
  readonly dynamicallyLoadedSkillIds?: readonly string[]
  readonly resolvedAgentsFiles?: readonly string[]
  readonly dynamicallyLoadedAgentsScopes?: readonly string[]
  readonly standardsWarnings?: readonly string[]
}

export interface AgentLifecycleHook {
  readonly id: string
  onRunStart?: (context: AgentRunContext) => void | Promise<void>
  onStreamChunk?: (context: AgentRunContext, chunk: AgentStreamChunk) => void | Promise<void>
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
  getTools?: (context: AgentRunContext) => readonly DomainServerTool[]
  filterTools?: (
    tools: readonly DomainServerTool[],
    context: AgentRunContext,
  ) => readonly DomainServerTool[]
  getLifecycleHooks?: (context: AgentRunContext) => readonly AgentLifecycleHook[]
}

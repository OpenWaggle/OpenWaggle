import type { HydratedAgentSendPayload, Message } from '@shared/types/agent'
import type { ContextCompactionResult, ContextUsageSnapshot } from '@shared/types/context-usage'
import type { Conversation } from '@shared/types/conversation'
import type { SupportedModelId } from '@shared/types/llm'
import type { AgentTransportEvent } from '@shared/types/stream'
import { Context, type Effect } from 'effect'
import type { ProjectedSessionNodeInput } from './session-repository'

export class AgentKernelMissingEntryError extends Error {
  readonly entryId: string

  constructor(entryId: string) {
    super(`Agent session entry is missing: ${entryId}`)
    this.name = 'AgentKernelMissingEntryError'
    this.entryId = entryId
  }
}

export function isAgentKernelMissingEntryError(
  error: unknown,
): error is AgentKernelMissingEntryError {
  return error instanceof AgentKernelMissingEntryError
}

export interface AgentKernelSessionSnapshot {
  readonly nodes: readonly ProjectedSessionNodeInput[]
  readonly activeNodeId: string | null
}

export interface AgentKernelRunInput {
  readonly conversation: Conversation
  readonly payload: HydratedAgentSendPayload
  readonly model: SupportedModelId
  readonly skillToggles?: Readonly<Record<string, boolean>>
  readonly signal: AbortSignal
  readonly onEvent: (event: AgentTransportEvent) => void
}

export interface AgentKernelWaggleTurnInput extends AgentKernelRunInput {
  readonly visibleUserRequest?: HydratedAgentSendPayload
}

export interface AgentKernelRunResult {
  readonly newMessages: readonly Message[]
  readonly piSessionId: string
  readonly piSessionFile?: string
  readonly sessionSnapshot: AgentKernelSessionSnapshot
  readonly aborted?: boolean
  readonly terminalError?: string
}

export interface AgentKernelCompactResult extends ContextCompactionResult {
  readonly piSessionId: string
  readonly piSessionFile?: string
  readonly sessionSnapshot: AgentKernelSessionSnapshot
}

export interface CreateAgentKernelSessionInput {
  readonly projectPath: string
}

export interface CreateAgentKernelSessionResult {
  readonly piSessionId: string
  readonly piSessionFile?: string
}

export interface AgentKernelSessionInput {
  readonly conversation: Conversation
  readonly model: SupportedModelId
  readonly skillToggles?: Readonly<Record<string, boolean>>
}

export interface CompactAgentKernelSessionInput extends AgentKernelSessionInput {
  readonly customInstructions?: string
  readonly signal?: AbortSignal
  readonly onEvent?: (event: AgentTransportEvent) => void
}

export interface NavigateAgentKernelSessionInput extends AgentKernelSessionInput {
  readonly targetNodeId: string
  readonly summarize?: boolean
  readonly customInstructions?: string
}

export interface AgentKernelNavigateTreeResult {
  readonly piSessionId: string
  readonly piSessionFile?: string
  readonly sessionSnapshot: AgentKernelSessionSnapshot
  readonly editorText?: string
  readonly cancelled: boolean
}

export interface AgentKernelServiceShape {
  readonly run: (input: AgentKernelRunInput) => Effect.Effect<AgentKernelRunResult, Error>
  readonly runWaggleTurn: (
    input: AgentKernelWaggleTurnInput,
  ) => Effect.Effect<AgentKernelRunResult, Error>
  readonly createSession: (
    input: CreateAgentKernelSessionInput,
  ) => Effect.Effect<CreateAgentKernelSessionResult, Error>
  readonly getContextUsage: (
    input: AgentKernelSessionInput,
  ) => Effect.Effect<ContextUsageSnapshot | null, Error>
  readonly compact: (
    input: CompactAgentKernelSessionInput,
  ) => Effect.Effect<AgentKernelCompactResult, Error>
  readonly navigateTree: (
    input: NavigateAgentKernelSessionInput,
  ) => Effect.Effect<AgentKernelNavigateTreeResult, Error>
}

export class AgentKernelService extends Context.Tag('@openwaggle/AgentKernelService')<
  AgentKernelService,
  AgentKernelServiceShape
>() {}

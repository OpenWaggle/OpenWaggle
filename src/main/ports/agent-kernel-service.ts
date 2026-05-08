import type { HydratedAgentSendPayload, Message } from '@shared/types/agent'
import type { ContextCompactionResult, ContextUsageSnapshot } from '@shared/types/context-usage'
import type { SupportedModelId } from '@shared/types/llm'
import type { SessionDetail } from '@shared/types/session'
import type { AgentTransportEvent } from '@shared/types/stream'
import type { WaggleConfig, WaggleStreamMetadata, WaggleTurnEvent } from '@shared/types/waggle'
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
  readonly session: SessionDetail
  readonly runId: string
  readonly payload: HydratedAgentSendPayload
  readonly model: SupportedModelId
  readonly skillToggles?: Readonly<Record<string, boolean>>
  readonly signal: AbortSignal
  readonly onEvent: (event: AgentTransportEvent) => void
}

export interface AgentKernelWaggleTurnCompletion {
  readonly meta: WaggleStreamMetadata
  readonly assistantMessages: readonly Message[]
  readonly responseText: string
  readonly hasToolCalls: boolean
  readonly terminalError?: string
}

export interface AgentKernelWaggleTurnDecision {
  readonly continue: boolean
}

export interface AgentKernelWaggleRunInput extends AgentKernelRunInput {
  readonly config: WaggleConfig
  readonly onWaggleEvent: (event: AgentTransportEvent, meta: WaggleStreamMetadata) => void
  readonly onTurnEvent: (event: WaggleTurnEvent) => void
  readonly createTurnMetadata: (input: {
    readonly turnNumber: number
    readonly agentIndex: number
  }) => WaggleStreamMetadata
  readonly onTurnComplete: (
    completion: AgentKernelWaggleTurnCompletion,
  ) => AgentKernelWaggleTurnDecision | Promise<AgentKernelWaggleTurnDecision>
}

export interface AgentKernelRunResult {
  readonly newMessages: readonly Message[]
  readonly piSessionId: string
  readonly piSessionFile?: string
  readonly sessionSnapshot: AgentKernelSessionSnapshot
  readonly aborted?: boolean
  readonly terminalError?: string
}

export interface AgentKernelSessionSnapshotResult {
  readonly piSessionId: string
  readonly piSessionFile?: string
  readonly sessionSnapshot: AgentKernelSessionSnapshot
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
  readonly session: SessionDetail
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

export type AgentKernelForkPosition = 'before' | 'at'

export interface ForkAgentKernelSessionInput extends AgentKernelSessionInput {
  readonly targetNodeId: string
  readonly position: AgentKernelForkPosition
}

export interface AgentKernelNavigateTreeResult {
  readonly piSessionId: string
  readonly piSessionFile?: string
  readonly sessionSnapshot: AgentKernelSessionSnapshot
  readonly editorText?: string
  readonly cancelled: boolean
}

export interface AgentKernelForkSessionResult {
  readonly piSessionId: string
  readonly piSessionFile?: string
  readonly sessionSnapshot: AgentKernelSessionSnapshot
  readonly editorText?: string
  readonly cancelled: boolean
}

export interface AgentKernelServiceShape {
  readonly run: (input: AgentKernelRunInput) => Effect.Effect<AgentKernelRunResult, Error>
  readonly runWaggle: (
    input: AgentKernelWaggleRunInput,
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
  readonly forkSession: (
    input: ForkAgentKernelSessionInput,
  ) => Effect.Effect<AgentKernelForkSessionResult, Error>
  readonly getSessionSnapshot: (
    input: AgentKernelSessionInput,
  ) => Effect.Effect<AgentKernelSessionSnapshotResult, Error>
}

export class AgentKernelService extends Context.Tag('@openwaggle/AgentKernelService')<
  AgentKernelService,
  AgentKernelServiceShape
>() {}

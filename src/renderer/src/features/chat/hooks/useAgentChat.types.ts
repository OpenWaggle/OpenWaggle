import type { AgentSendPayload } from '@shared/types/agent'
import type {
  AgentLoopInteraction,
  AgentLoopInteractionResponse,
} from '@shared/types/agent-loop-interaction'
import type { SessionId } from '@shared/types/brand'
import type { UIMessage } from '@shared/types/chat-ui'
import type { IpcEventPayload } from '@shared/types/ipc'
import type { SessionDetail } from '@shared/types/session'
import type { AgentTransportCustomEvent } from '@shared/types/stream'
import type { WaggleConfig } from '@shared/types/waggle'
import type { AgentInteractionEvent } from '../lib/types-chat-row'

export type AgentChatStatus =
  | 'ready'
  | 'submitted'
  | 'streaming'
  | 'compacting'
  | 'retrying'
  | 'error'

export type AgentCompactionStatus =
  | { readonly type: 'compacting'; readonly reason: 'manual' | 'threshold' | 'overflow' }
  | {
      readonly type: 'retrying'
      readonly attempt: number
      readonly maxAttempts: number
      readonly delayMs: number
      readonly errorMessage: string
    }

export interface AgentChatReturn {
  messages: UIMessage[]
  sendMessage: (payload: AgentSendPayload) => Promise<void>
  sendWaggleMessage: (payload: AgentSendPayload, config: WaggleConfig) => Promise<void>
  isLoading: boolean
  status: AgentChatStatus
  stop: () => void
  steer: () => Promise<void>
  error: Error | undefined
  withDeferredSnapshotRefresh: <T>(operation: () => Promise<T>) => Promise<T>
  previewSteeredUserTurn: (payload: AgentSendPayload) => () => void
  backgroundStreaming: boolean
  streamSignalVersion: number
  compactionStatus: AgentCompactionStatus | null
  agentInteractions: readonly AgentLoopInteraction[]
  agentCustomMessages: readonly AgentTransportCustomEvent[]
  agentInteractionEvents: readonly AgentInteractionEvent[]
  respondAgentInteraction: (
    interaction: AgentLoopInteraction,
    response: AgentLoopInteractionResponse,
  ) => Promise<void>
}

export interface PendingRunWaiter {
  readonly resolve: () => void
  readonly reject: (error: Error) => void
}

export interface AgentRunActions {
  readonly flushDeferredSessionSnapshot: () => void
  readonly settlePendingRun: (nextError?: Error) => void
}

export interface UpdateMessagesOptions {
  readonly cacheRunSnapshot?: boolean
}

export interface MutableValueRef<T> {
  current: T
}

export type SetMessagesBySessionId = (messagesBySessionId: Map<SessionId, UIMessage[]>) => void
export type SetRunRenderMessages = (sessionId: SessionId, messages: UIMessage[]) => void
export type SetAgentChatStatus = (status: AgentChatStatus) => void
export type SetAgentChatError = (error: Error | undefined) => void
export type SetBackgroundStreaming = (backgroundStreaming: boolean) => void
export type SetCompactionStatus = (status: AgentCompactionStatus | null) => void
export type SetAgentInteractionsBySessionId = (
  interactionsBySessionId: Map<SessionId, readonly AgentLoopInteraction[]>,
) => void
export type SetAgentCustomMessagesBySessionId = (
  messagesBySessionId: Map<SessionId, readonly AgentTransportCustomEvent[]>,
) => void
export type SetAgentInteractionEventsBySessionId = (
  eventsBySessionId: Map<SessionId, readonly AgentInteractionEvent[]>,
) => void

export interface AgentStreamEventContext {
  readonly subscribedSessionId: SessionId
  readonly currentSessionIdRef: MutableValueRef<SessionId | null>
  readonly foregroundStreamActiveRef: MutableValueRef<boolean>
  readonly backgroundStreamingRef: MutableValueRef<boolean>
  readonly backgroundReconnectSessionIdRef: MutableValueRef<SessionId | null>
  readonly streamSignalVersionRef: MutableValueRef<number>
  readonly terminalRunErrorRef: MutableValueRef<Error | undefined>
  readonly agentInteractionsBySessionIdRef: MutableValueRef<
    Map<SessionId, readonly AgentLoopInteraction[]>
  >
  readonly agentCustomMessagesBySessionIdRef: MutableValueRef<
    Map<SessionId, readonly AgentTransportCustomEvent[]>
  >
  readonly agentInteractionEventsBySessionIdRef: MutableValueRef<
    Map<SessionId, readonly AgentInteractionEvent[]>
  >
  readonly messagesBySessionIdRef: MutableValueRef<Map<SessionId, UIMessage[]>>
  readonly setMessagesBySessionId: SetMessagesBySessionId
  readonly setRunRenderMessages: SetRunRenderMessages
  readonly setError: SetAgentChatError
  readonly setAgentInteractionsBySessionId: SetAgentInteractionsBySessionId
  readonly setAgentCustomMessagesBySessionId: SetAgentCustomMessagesBySessionId
  readonly setAgentInteractionEventsBySessionId: SetAgentInteractionEventsBySessionId
  readonly setStatus: SetAgentChatStatus
  readonly setCompactionStatus: SetCompactionStatus
  readonly setBackgroundStreaming: SetBackgroundStreaming
}

export interface SessionHydrationContext {
  readonly currentSessionIdRef: MutableValueRef<SessionId | null>
  readonly foregroundStreamActiveRef: MutableValueRef<boolean>
  readonly foregroundSessionIdRef: MutableValueRef<SessionId | null>
  readonly pendingRunWaiterRef: MutableValueRef<PendingRunWaiter | null>
  readonly terminalRunErrorRef: MutableValueRef<Error | undefined>
  readonly streamSignalVersionRef: MutableValueRef<number>
  readonly lastHydratedSessionIdRef: MutableValueRef<SessionId | null>
  readonly lastHydratedSnapshotKeyRef: MutableValueRef<string | null>
  readonly lastHydratedOptimisticKeyRef: MutableValueRef<string | null>
  readonly backgroundStreamingRef: MutableValueRef<boolean>
  readonly backgroundReconnectSessionIdRef: MutableValueRef<SessionId | null>
  readonly messagesBySessionIdRef: MutableValueRef<Map<SessionId, UIMessage[]>>
  readonly setMessagesBySessionId: SetMessagesBySessionId
  readonly setRunRenderMessages: SetRunRenderMessages
  readonly setBackgroundStreaming: SetBackgroundStreaming
  readonly setCompactionStatus: SetCompactionStatus
  readonly setStatus: SetAgentChatStatus
  readonly setError: SetAgentChatError
}

export interface SessionHydrationInput {
  readonly sessionId: SessionId
  readonly session: SessionDetail
  readonly optimisticUserMessages: readonly UIMessage[]
  readonly hasActiveRun: boolean
  readonly cachedRenderMessages: readonly UIMessage[] | null
}

export interface SessionHydrationKeys {
  readonly snapshotKey: string
  readonly optimisticKey: string
  readonly sessionChanged: boolean
  readonly snapshotChanged: boolean
  readonly optimisticChanged: boolean
}

export type AgentEventPayload = IpcEventPayload<'agent:event'>

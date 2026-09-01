import type { AgentSendPayload } from '@shared/types/agent'
import type { AgentLoopInteraction } from '@shared/types/agent-loop-interaction'
import type { SessionId } from '@shared/types/brand'
import type { UIMessage } from '@shared/types/chat-ui'
import type { SupportedModelId } from '@shared/types/llm'
import type { SessionDetail } from '@shared/types/session'
import type { ThinkingLevel } from '@shared/types/settings'
import type { WaggleConfig } from '@shared/types/waggle'
import { useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
import { useAgentLoopEventStore } from '@/features/chat/state/agent-loop-event-store'
import { useBackgroundRunStore } from '@/features/chat/state/background-run-store'
import { useChatStore } from '@/features/chat/state/chat-store'
import {
  selectOptimisticUserMessages,
  useOptimisticUserMessageStore,
} from '@/features/chat/state/optimistic-user-message-store'
import { buildClientUserMessage } from '../lib/useAgentChat.utils'
import {
  type RunCompletionEffectContext,
  useAgentEventEffects,
  useSessionHydrationEffects,
} from './useAgentChat.effects'
import { respondAgentInteraction } from './useAgentChat.interactions'
import { EMPTY_UI_MESSAGES } from './useAgentChat.message-cache'
import { createAgentRunControls } from './useAgentChat.run-controls'
import { StreamSignalVersionStore } from './useAgentChat.stream-signal'
import type {
  AgentChatReturn,
  AgentChatStatus,
  AgentCompactionStatus,
  AgentRunActions,
  AgentStreamEventContext,
  PendingRunWaiter,
  SessionHydrationContext,
} from './useAgentChat.types'
import { useOptimisticSteeredTurn } from './useOptimisticSteeredTurn'

export type { AgentChatStatus, AgentCompactionStatus } from './useAgentChat.types'

const EMPTY_AGENT_INTERACTIONS: readonly AgentLoopInteraction[] = []
const EMPTY_AGENT_CUSTOM_MESSAGES: AgentChatReturn['agentCustomMessages'] = []
const EMPTY_AGENT_INTERACTION_EVENTS: AgentChatReturn['agentInteractionEvents'] = []

export function useAgentChat(
  sessionId: SessionId | null,
  session: SessionDetail | null,
  model: SupportedModelId,
  _thinkingLevel: ThinkingLevel,
): AgentChatReturn {
  const upsertSession = useChatStore((state) => state.upsertSession)
  const hasActiveRun = useBackgroundRunStore((state) => state.hasActiveRun)
  const getRunRenderSnapshot = useBackgroundRunStore((state) => state.getRunRenderSnapshot)
  const setRunRenderMessages = useBackgroundRunStore((state) => state.setRunRenderMessages)
  const setRunCompactionStatus = useBackgroundRunStore((state) => state.setRunCompactionStatus)
  const setFirstSendRecovery = useBackgroundRunStore((state) => state.setFirstSendRecovery)
  const agentLoopSessionState = useAgentLoopEventStore((state) =>
    sessionId ? state.sessionsById.get(sessionId) : undefined,
  )
  const optimisticUserMessages = useOptimisticUserMessageStore(
    selectOptimisticUserMessages(sessionId),
  )
  const addOptimisticUserMessage = useOptimisticUserMessageStore((state) => state.add)
  const removeMatchedOptimisticUserMessages = useOptimisticUserMessageStore(
    (state) => state.removeMatched,
  )
  const [messagesBySessionId, setMessagesBySessionId] = useState(
    () => new Map<SessionId, UIMessage[]>(),
  )
  const [status, setStatus] = useState<AgentChatStatus>('ready')
  const [error, setError] = useState<Error | undefined>(undefined)
  const [backgroundStreaming, setBackgroundStreaming] = useState(false)
  const [compactionStatus, setCompactionStatus] = useState<AgentCompactionStatus | null>(null)
  const messagesBySessionIdRef = useRef(messagesBySessionId)
  const messages = sessionId
    ? (messagesBySessionId.get(sessionId) ?? EMPTY_UI_MESSAGES)
    : EMPTY_UI_MESSAGES
  const agentInteractions = agentLoopSessionState?.interactions ?? EMPTY_AGENT_INTERACTIONS
  const agentCustomMessages = agentLoopSessionState?.customMessages ?? EMPTY_AGENT_CUSTOM_MESSAGES
  const agentInteractionEvents =
    agentLoopSessionState?.interactionEvents ?? EMPTY_AGENT_INTERACTION_EVENTS
  const isLoading = backgroundStreaming || (status !== 'ready' && status !== 'error')
  const isSessionIdle = !isLoading

  const currentSessionIdRef = useRef(sessionId)
  const statusRef = useRef(status)
  const backgroundStreamingRef = useRef(backgroundStreaming)
  const messagesRef = useRef(messages)
  const foregroundStreamActiveRef = useRef(false)
  const foregroundSessionIdRef = useRef<SessionId | null>(null)
  const terminalRunErrorRef = useRef<Error | undefined>(undefined)
  const compactionSummaryCountAtStartRef = useRef(0)
  const compactionStatusRef = useRef<AgentCompactionStatus | null>(null)
  const updateCompactionStatus = (nextStatus: AgentCompactionStatus | null) => {
    compactionStatusRef.current = nextStatus
    setCompactionStatus(nextStatus)
  }
  const backgroundReconnectSessionIdRef = useRef<SessionId | null>(null)
  const [streamSignalVersionRef] = useState(() => new StreamSignalVersionStore())
  const streamSignalVersion = useSyncExternalStore(
    streamSignalVersionRef.subscribe,
    streamSignalVersionRef.getSnapshot,
    streamSignalVersionRef.getSnapshot,
  )
  const deferredRefreshSessionIdRef = useRef<SessionId | null>(null)
  const deferredSnapshotRefreshCountRef = useRef(0)
  const lastHydratedSessionIdRef = useRef<SessionId | null>(null)
  const lastHydratedSnapshotKeyRef = useRef<string | null>(null)
  const lastHydratedOptimisticKeyRef = useRef<string | null>(null)
  const pendingRunWaiterRef = useRef<PendingRunWaiter | null>(null)
  const agentRunActionsRef = useRef<AgentRunActions | null>(null)

  useLayoutEffect(() => {
    messagesBySessionIdRef.current = messagesBySessionId
    currentSessionIdRef.current = sessionId
    statusRef.current = status
    backgroundStreamingRef.current = backgroundStreaming
    messagesRef.current = messages
  }, [messagesBySessionId, sessionId, status, backgroundStreaming, messages])

  const { visibleMessages, previewSteeredUserTurn } = useOptimisticSteeredTurn(
    messages,
    sessionId,
    buildClientUserMessage,
    messagesRef,
  )
  const refs = {
    currentSessionIdRef,
    statusRef,
    backgroundStreamingRef,
    foregroundStreamActiveRef,
    foregroundSessionIdRef,
    terminalRunErrorRef,
    backgroundReconnectSessionIdRef,
    deferredRefreshSessionIdRef,
    deferredSnapshotRefreshCountRef,
    pendingRunWaiterRef,
    messagesBySessionIdRef,
  }
  const runControls = createAgentRunControls({
    sessionId,
    isFirstMessage: session?.messages.length === 0,
    model,
    refs,
    setMessagesBySessionId,
    setRunRenderMessages,
    setFirstSendRecovery,
    setBackgroundStreaming,
    setError,
    setStatus,
    setCompactionStatus: updateCompactionStatus,
    addOptimisticUserMessage,
    upsertSession,
  })
  useLayoutEffect(() => {
    agentRunActionsRef.current = runControls.runActions
  }, [runControls.runActions])

  const [hydrationContext] = useState<SessionHydrationContext>(() => ({
    currentSessionIdRef,
    foregroundStreamActiveRef,
    foregroundSessionIdRef,
    pendingRunWaiterRef,
    terminalRunErrorRef,
    streamSignalVersionRef,
    compactionSummaryCountAtStartRef,
    lastHydratedSessionIdRef,
    lastHydratedSnapshotKeyRef,
    lastHydratedOptimisticKeyRef,
    backgroundStreamingRef,
    backgroundReconnectSessionIdRef,
    messagesBySessionIdRef,
    setMessagesBySessionId,
    setRunRenderMessages,
    setBackgroundStreaming,
    setCompactionStatus: updateCompactionStatus,
    setRunCompactionStatus,
    setStatus,
    setError,
  }))

  const [streamEventContext] = useState<Omit<AgentStreamEventContext, 'subscribedSessionId'>>(
    () => ({
      currentSessionIdRef,
      foregroundStreamActiveRef,
      backgroundStreamingRef,
      backgroundReconnectSessionIdRef,
      streamSignalVersionRef,
      compactionSummaryCountAtStartRef,
      compactionStatusRef,
      terminalRunErrorRef,
      messagesBySessionIdRef,
      setMessagesBySessionId,
      setRunRenderMessages,
      setError,
      setStatus,
      setCompactionStatus: updateCompactionStatus,
      setBackgroundStreaming,
    }),
  )

  const [runCompletionContext] = useState<RunCompletionEffectContext>(() => ({
    currentSessionIdRef,
    foregroundStreamActiveRef,
    foregroundSessionIdRef,
    terminalRunErrorRef,
    backgroundStreamingRef,
    backgroundReconnectSessionIdRef,
    deferredRefreshSessionIdRef,
    deferredSnapshotRefreshCountRef,
    statusRef,
    setBackgroundStreaming,
    setCompactionStatus: updateCompactionStatus,
    setStatus,
    agentRunActionsRef,
  }))

  useSessionHydrationEffects({
    sessionId,
    session,
    isSessionIdle,
    optimisticUserMessages,
    hasActiveRun,
    getRunRenderSnapshot,
    removeMatchedOptimisticUserMessages,
    context: hydrationContext,
  })
  useAgentEventEffects({
    sessionId,
    streamEventContext,
    runCompletionContext,
  })

  return {
    messages: visibleMessages,
    sendMessage: async (payload: AgentSendPayload) =>
      runControls.withDeferredSnapshotRefresh(async () => {
        await runControls.sendUserPayload(payload, null)
      }),
    sendWaggleMessage: async (payload: AgentSendPayload, config: WaggleConfig) =>
      runControls.withDeferredSnapshotRefresh(async () => {
        await runControls.sendUserPayload(payload, config)
      }),
    isLoading,
    status: backgroundStreaming ? 'streaming' : status,
    stop: runControls.stop,
    steer: runControls.steer,
    error,
    withDeferredSnapshotRefresh: runControls.withDeferredSnapshotRefresh,
    previewSteeredUserTurn,
    backgroundStreaming,
    streamSignalVersion,
    compactionStatus,
    agentInteractions,
    agentCustomMessages,
    agentInteractionEvents,
    respondAgentInteraction,
  }
}

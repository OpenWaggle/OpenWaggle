import type { AgentSendPayload } from '@shared/types/agent'
import type {
  AgentLoopInteraction,
  AgentLoopInteractionResponse,
} from '@shared/types/agent-loop-interaction'
import type { SessionId } from '@shared/types/brand'
import type { UIMessage } from '@shared/types/chat-ui'
import type { SupportedModelId } from '@shared/types/llm'
import type { SessionDetail } from '@shared/types/session'
import type { ThinkingLevel } from '@shared/types/settings'
import type { AgentTransportCustomEvent } from '@shared/types/stream'
import type { WaggleConfig } from '@shared/types/waggle'
import { useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
import { useBackgroundRunStore } from '@/features/chat/state/background-run-store'
import { useChatStore } from '@/features/chat/state/chat-store'
import {
  selectOptimisticUserMessages,
  useOptimisticUserMessageStore,
} from '@/features/chat/state/optimistic-user-message-store'
import { api } from '@/shared/lib/ipc'
import { buildClientUserMessage } from '../lib/useAgentChat.utils'
import {
  type RunCompletionEffectContext,
  useAgentEventEffects,
  useSessionHydrationEffects,
} from './useAgentChat.effects'
import { EMPTY_UI_MESSAGES } from './useAgentChat.message-cache'
import { createAgentRunControls } from './useAgentChat.run-controls'
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

class StreamSignalVersionStore extends EventTarget {
  private value = 0

  get current() {
    return this.value
  }

  set current(value: number) {
    if (this.value === value) {
      return
    }
    this.value = value
    this.dispatchEvent(new Event('change'))
  }

  readonly getSnapshot = () => this.value

  readonly subscribe = (listener: () => void) => {
    this.addEventListener('change', listener)
    return () => this.removeEventListener('change', listener)
  }
}

function valueForSession<T extends readonly unknown[]>(
  valuesBySessionId: ReadonlyMap<SessionId, T>,
  sessionId: SessionId | null,
  empty: T,
) {
  if (sessionId === null) {
    return empty
  }

  return valuesBySessionId.get(sessionId) ?? empty
}

async function respondAgentInteraction(
  interaction: AgentLoopInteraction,
  response: AgentLoopInteractionResponse,
) {
  const result = await api.respondAgentInteraction({
    sessionId: interaction.sessionId,
    runId: interaction.runId,
    interactionId: interaction.interactionId,
    kind: interaction.kind,
    response,
  })
  if (!result.ok) {
    throw new Error(result.error.message)
  }
}

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
  const [agentInteractionsBySessionId, setAgentInteractionsBySessionId] = useState(
    () => new Map<SessionId, readonly AgentLoopInteraction[]>(),
  )
  const [agentCustomMessagesBySessionId, setAgentCustomMessagesBySessionId] = useState(
    () => new Map<SessionId, readonly AgentTransportCustomEvent[]>(),
  )
  const [agentInteractionEventsBySessionId, setAgentInteractionEventsBySessionId] = useState(
    () => new Map<SessionId, AgentChatReturn['agentInteractionEvents']>(),
  )
  const [status, setStatus] = useState<AgentChatStatus>('ready')
  const [error, setError] = useState<Error | undefined>(undefined)
  const [backgroundStreaming, setBackgroundStreaming] = useState(false)
  const [compactionStatus, setCompactionStatus] = useState<AgentCompactionStatus | null>(null)
  const messagesBySessionIdRef = useRef(messagesBySessionId)
  const agentInteractionsBySessionIdRef = useRef(agentInteractionsBySessionId)
  const agentCustomMessagesBySessionIdRef = useRef(agentCustomMessagesBySessionId)
  const agentInteractionEventsBySessionIdRef = useRef(agentInteractionEventsBySessionId)
  const messages = valueForSession(messagesBySessionId, sessionId, EMPTY_UI_MESSAGES)
  const agentInteractions = valueForSession(agentInteractionsBySessionId, sessionId, [])
  const agentCustomMessages = valueForSession(agentCustomMessagesBySessionId, sessionId, [])
  const agentInteractionEvents = valueForSession(agentInteractionEventsBySessionId, sessionId, [])
  const isLoading = backgroundStreaming || (status !== 'ready' && status !== 'error')
  const isSessionIdle = !isLoading

  const currentSessionIdRef = useRef(sessionId)
  const statusRef = useRef(status)
  const backgroundStreamingRef = useRef(backgroundStreaming)
  const messagesRef = useRef(messages)
  const foregroundStreamActiveRef = useRef(false)
  const foregroundSessionIdRef = useRef<SessionId | null>(null)
  const terminalRunErrorRef = useRef<Error | undefined>(undefined)
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
    agentInteractionsBySessionIdRef.current = agentInteractionsBySessionId
    agentCustomMessagesBySessionIdRef.current = agentCustomMessagesBySessionId
    agentInteractionEventsBySessionIdRef.current = agentInteractionEventsBySessionId
    currentSessionIdRef.current = sessionId
    statusRef.current = status
    backgroundStreamingRef.current = backgroundStreaming
    messagesRef.current = messages
  }, [
    messagesBySessionId,
    agentInteractionsBySessionId,
    agentCustomMessagesBySessionId,
    agentInteractionEventsBySessionId,
    sessionId,
    status,
    backgroundStreaming,
    messages,
  ])

  const { visibleMessages, previewSteeredUserTurn } = useOptimisticSteeredTurn(
    messages,
    sessionId,
    isSessionIdle,
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
    model,
    refs,
    setMessagesBySessionId,
    setRunRenderMessages,
    setBackgroundStreaming,
    setError,
    setStatus,
    setCompactionStatus,
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
    lastHydratedSessionIdRef,
    lastHydratedSnapshotKeyRef,
    lastHydratedOptimisticKeyRef,
    backgroundStreamingRef,
    backgroundReconnectSessionIdRef,
    messagesBySessionIdRef,
    setMessagesBySessionId,
    setRunRenderMessages,
    setBackgroundStreaming,
    setCompactionStatus,
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
      terminalRunErrorRef,
      agentInteractionsBySessionIdRef,
      agentCustomMessagesBySessionIdRef,
      agentInteractionEventsBySessionIdRef,
      messagesBySessionIdRef,
      setMessagesBySessionId,
      setRunRenderMessages,
      setError,
      setAgentInteractionsBySessionId,
      setAgentCustomMessagesBySessionId,
      setAgentInteractionEventsBySessionId,
      setStatus,
      setCompactionStatus,
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
    setCompactionStatus,
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

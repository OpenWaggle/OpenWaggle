import { matchBy } from '@diegogbrisa/ts-match'
import type { AgentSendPayload } from '@shared/types/agent'
import type { SessionId } from '@shared/types/brand'
import type { UIMessage } from '@shared/types/chat-ui'
import type { IpcEventPayload } from '@shared/types/ipc'
import type { SupportedModelId } from '@shared/types/llm'
import type { SessionDetail } from '@shared/types/session'
import type { ThinkingLevel } from '@shared/types/settings'
import type { WaggleConfig } from '@shared/types/waggle'
import { useEffect, useRef, useState } from 'react'
import { clearLastAgentErrorInfo, setLastAgentErrorInfo } from '@/lib/agent-error-store'
import { applyAgentTransportEvent } from '@/lib/chat-stream-state'
import { api } from '@/lib/ipc'
import { useBackgroundRunStore } from '@/stores/background-run-store'
import { useChatStore } from '@/stores/chat-store'
import {
  selectOptimisticUserMessages,
  useOptimisticUserMessageStore,
} from '@/stores/optimistic-user-message-store'
import {
  appendMissingOptimisticUserMessages,
  buildClientUserMessage,
  buildPartialAssistantMessage,
  createOptimisticUserMessage,
  mergeBackgroundReconnectMessages,
  reconcileSnapshotUserMessages,
  sessionToUIMessages,
} from './useAgentChat.utils'
import { useOptimisticSteeredTurn } from './useOptimisticSteeredTurn'

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

interface AgentChatReturn {
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
}

interface PendingRunWaiter {
  readonly resolve: () => void
  readonly reject: (error: Error) => void
}

interface AgentRunActions {
  readonly flushDeferredSessionSnapshot: () => void
  readonly settlePendingRun: (nextError?: Error) => void
}

interface UpdateMessagesOptions {
  readonly cacheRunSnapshot?: boolean
}

interface MutableValueRef<T> {
  current: T
}

type SetMessagesBySessionId = (messagesBySessionId: Map<SessionId, UIMessage[]>) => void
type SetRunRenderMessages = (sessionId: SessionId, messages: UIMessage[]) => void
type SetAgentChatStatus = (status: AgentChatStatus) => void
type SetAgentChatError = (error: Error | undefined) => void
type SetBackgroundStreaming = (backgroundStreaming: boolean) => void
type SetCompactionStatus = (status: AgentCompactionStatus | null) => void

interface AgentStreamEventContext {
  readonly subscribedSessionId: SessionId
  readonly currentSessionIdRef: MutableValueRef<SessionId | null>
  readonly foregroundStreamActiveRef: MutableValueRef<boolean>
  readonly backgroundStreamingRef: MutableValueRef<boolean>
  readonly backgroundReconnectSessionIdRef: MutableValueRef<SessionId | null>
  readonly streamSignalVersionRef: MutableValueRef<number>
  readonly terminalRunErrorRef: MutableValueRef<Error | undefined>
  readonly messagesBySessionIdRef: MutableValueRef<Map<SessionId, UIMessage[]>>
  readonly setMessagesBySessionId: SetMessagesBySessionId
  readonly setRunRenderMessages: SetRunRenderMessages
  readonly setError: SetAgentChatError
  readonly setStatus: SetAgentChatStatus
  readonly setCompactionStatus: SetCompactionStatus
  readonly setBackgroundStreaming: SetBackgroundStreaming
}

interface SessionHydrationContext {
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

interface SessionHydrationInput {
  readonly sessionId: SessionId
  readonly session: SessionDetail
  readonly optimisticUserMessages: readonly UIMessage[]
  readonly hasActiveRun: boolean
  readonly cachedRenderMessages: readonly UIMessage[] | null
}

interface SessionHydrationKeys {
  readonly snapshotKey: string
  readonly optimisticKey: string
  readonly sessionChanged: boolean
  readonly snapshotChanged: boolean
  readonly optimisticChanged: boolean
}

const EMPTY_UI_MESSAGES: UIMessage[] = []

function createPendingRunWaiter(): {
  readonly promise: Promise<void>
  readonly waiter: PendingRunWaiter
} {
  let resolveRun = () => {}
  let rejectRun = (_error: Error) => {}
  const promise = new Promise<void>((resolve, reject) => {
    resolveRun = resolve
    rejectRun = reject
  })
  return {
    promise,
    waiter: {
      resolve: resolveRun,
      reject: rejectRun,
    },
  }
}

function buildSessionSnapshotKey(session: SessionDetail): string {
  const lastMessage = session.messages[session.messages.length - 1]
  return `${String(session.updatedAt)}:${String(session.messages.length)}:${lastMessage ? String(lastMessage.id) : 'none'}`
}

function buildOptimisticMessagesKey(messages: readonly UIMessage[]): string {
  return messages.map((message) => message.id).join(':')
}

function mergeSessionAndOptimisticMessages(
  session: SessionDetail,
  optimisticUserMessages: readonly UIMessage[],
): UIMessage[] {
  return appendMissingOptimisticUserMessages(sessionToUIMessages(session), optimisticUserMessages)
}

function getMessagesForSession(
  messagesBySessionIdRef: MutableValueRef<Map<SessionId, UIMessage[]>>,
  targetSessionId: SessionId,
): UIMessage[] {
  return messagesBySessionIdRef.current.get(targetSessionId) ?? EMPTY_UI_MESSAGES
}

function setMessagesForSession(
  messagesBySessionIdRef: MutableValueRef<Map<SessionId, UIMessage[]>>,
  setMessagesBySessionId: SetMessagesBySessionId,
  setRunRenderMessages: SetRunRenderMessages,
  targetSessionId: SessionId,
  nextMessages: UIMessage[],
  options: UpdateMessagesOptions = {},
): void {
  const nextMessagesBySessionId = new Map(messagesBySessionIdRef.current)
  nextMessagesBySessionId.set(targetSessionId, nextMessages)
  messagesBySessionIdRef.current = nextMessagesBySessionId
  setMessagesBySessionId(nextMessagesBySessionId)

  if (options.cacheRunSnapshot) {
    setRunRenderMessages(targetSessionId, nextMessages)
  }
}

function updateMessagesForSession(
  messagesBySessionIdRef: MutableValueRef<Map<SessionId, UIMessage[]>>,
  setMessagesBySessionId: SetMessagesBySessionId,
  setRunRenderMessages: SetRunRenderMessages,
  targetSessionId: SessionId,
  update: (currentMessages: UIMessage[]) => UIMessage[],
  options: UpdateMessagesOptions = {},
): void {
  setMessagesForSession(
    messagesBySessionIdRef,
    setMessagesBySessionId,
    setRunRenderMessages,
    targetSessionId,
    update(getMessagesForSession(messagesBySessionIdRef, targetSessionId)),
    options,
  )
}

function signalStreamChange(context: AgentStreamEventContext): void {
  context.streamSignalVersionRef.current += 1
}

function setReadyIfNoActiveRun(context: AgentStreamEventContext): void {
  if (!context.foregroundStreamActiveRef.current && !context.backgroundStreamingRef.current) {
    context.setStatus('ready')
  }
}

function handleAgentStartEvent(context: AgentStreamEventContext): void {
  signalStreamChange(context)
  clearLastAgentErrorInfo(context.subscribedSessionId)
  context.setError(undefined)
  context.setStatus('streaming')
  if (!context.foregroundStreamActiveRef.current) {
    context.backgroundStreamingRef.current = true
    context.backgroundReconnectSessionIdRef.current = context.subscribedSessionId
    context.setBackgroundStreaming(true)
  }
}

function handleCompactionEndEvent(
  event: Extract<IpcEventPayload<'agent:event'>['event'], { readonly type: 'compaction_end' }>,
  context: AgentStreamEventContext,
): void {
  signalStreamChange(context)
  context.setCompactionStatus(null)
  const hasCompactionError = event.errorMessage !== undefined && !event.aborted
  if (hasCompactionError) {
    const nextError = new Error(event.errorMessage)
    context.setError(nextError)
    context.setStatus('error')
    return
  }
  setReadyIfNoActiveRun(context)
}

function handleAutoRetryEndEvent(
  event: Extract<IpcEventPayload<'agent:event'>['event'], { readonly type: 'auto_retry_end' }>,
  context: AgentStreamEventContext,
): void {
  signalStreamChange(context)
  context.setCompactionStatus(null)
  const hasRetryError = !event.success && event.finalError !== undefined
  if (hasRetryError) {
    const nextError = new Error(event.finalError)
    context.setError(nextError)
    context.setStatus('error')
    return
  }
  setReadyIfNoActiveRun(context)
}

function handleAgentEndEvent(
  event: Extract<IpcEventPayload<'agent:event'>['event'], { readonly type: 'agent_end' }>,
  context: AgentStreamEventContext,
): void {
  if (event.reason !== 'error' || !event.error) {
    return
  }

  signalStreamChange(context)
  const nextError = new Error(event.error.message)
  context.terminalRunErrorRef.current = nextError
  setLastAgentErrorInfo(context.subscribedSessionId, event.error)
  context.setError(nextError)
  context.setStatus('error')
}

function handleAgentStateEvent(
  event: IpcEventPayload<'agent:event'>['event'],
  context: AgentStreamEventContext,
): void {
  matchBy(event, 'type')
    .with('agent_start', () => handleAgentStartEvent(context))
    .with('compaction_start', (value) => {
      signalStreamChange(context)
      context.setError(undefined)
      context.setStatus('compacting')
      context.setCompactionStatus({ type: 'compacting', reason: value.reason })
    })
    .with('compaction_end', (value) => handleCompactionEndEvent(value, context))
    .with('auto_retry_start', (value) => {
      signalStreamChange(context)
      context.setStatus('retrying')
      context.setCompactionStatus({
        type: 'retrying',
        attempt: value.attempt,
        maxAttempts: value.maxAttempts,
        delayMs: value.delayMs,
        errorMessage: value.errorMessage,
      })
    })
    .with('auto_retry_end', (value) => handleAutoRetryEndEvent(value, context))
    .with('agent_end', (value) => handleAgentEndEvent(value, context))
    .with(
      'turn_start',
      'turn_end',
      'message_start',
      'message_update',
      'message_end',
      'tool_execution_start',
      'tool_execution_update',
      'tool_execution_end',
      'queue_update',
      'custom',
      () => undefined,
    )
    .exhaustive()
}

function shouldHandleStreamPayload(
  payload: IpcEventPayload<'agent:event'>,
  context: AgentStreamEventContext,
): boolean {
  return (
    payload.sessionId === context.subscribedSessionId &&
    context.currentSessionIdRef.current === context.subscribedSessionId
  )
}

function handleAgentStreamPayload(
  payload: IpcEventPayload<'agent:event'>,
  context: AgentStreamEventContext,
): void {
  if (!shouldHandleStreamPayload(payload, context)) {
    return
  }

  handleAgentStateEvent(payload.event, context)

  if (context.foregroundStreamActiveRef.current || context.backgroundStreamingRef.current) {
    signalStreamChange(context)
    updateMessagesForSession(
      context.messagesBySessionIdRef,
      context.setMessagesBySessionId,
      context.setRunRenderMessages,
      context.subscribedSessionId,
      (currentMessages) => applyAgentTransportEvent(currentMessages, payload.event),
      { cacheRunSnapshot: true },
    )
  }
}

function resolvePendingForegroundRun(context: SessionHydrationContext): void {
  const pending = context.pendingRunWaiterRef.current
  context.pendingRunWaiterRef.current = null
  pending?.resolve()
}

function clearForegroundRunState(context: SessionHydrationContext): void {
  context.foregroundStreamActiveRef.current = false
  context.foregroundSessionIdRef.current = null
  context.terminalRunErrorRef.current = undefined
}

function resetMissingSessionHydration(context: SessionHydrationContext): void {
  if (context.foregroundStreamActiveRef.current) {
    resolvePendingForegroundRun(context)
  }
  clearForegroundRunState(context)
  context.streamSignalVersionRef.current = 0
  context.lastHydratedSessionIdRef.current = null
  context.lastHydratedSnapshotKeyRef.current = null
  context.lastHydratedOptimisticKeyRef.current = null
  context.setStatus('ready')
  context.setCompactionStatus(null)
  context.setError(undefined)
}

function getSessionHydrationKeys(
  input: SessionHydrationInput,
  context: SessionHydrationContext,
): SessionHydrationKeys {
  const snapshotKey = buildSessionSnapshotKey(input.session)
  const optimisticKey = buildOptimisticMessagesKey(input.optimisticUserMessages)
  return {
    snapshotKey,
    optimisticKey,
    sessionChanged: context.lastHydratedSessionIdRef.current !== input.sessionId,
    snapshotChanged: context.lastHydratedSnapshotKeyRef.current !== snapshotKey,
    optimisticChanged: context.lastHydratedOptimisticKeyRef.current !== optimisticKey,
  }
}

function updateHydrationKeys(
  sessionId: SessionId,
  keys: SessionHydrationKeys,
  context: SessionHydrationContext,
): void {
  context.lastHydratedSessionIdRef.current = sessionId
  context.lastHydratedSnapshotKeyRef.current = keys.snapshotKey
  context.lastHydratedOptimisticKeyRef.current = keys.optimisticKey
}

function resetSessionChangedState(
  keys: SessionHydrationKeys,
  context: SessionHydrationContext,
): void {
  if (!keys.sessionChanged) {
    return
  }
  context.setBackgroundStreaming(false)
  context.backgroundStreamingRef.current = false
  context.backgroundReconnectSessionIdRef.current = null
  context.setCompactionStatus(null)
}

function shouldKeepForegroundHydration(
  input: SessionHydrationInput,
  keys: SessionHydrationKeys,
  context: SessionHydrationContext,
): boolean {
  if (!context.foregroundStreamActiveRef.current) {
    return false
  }
  if (context.foregroundSessionIdRef.current !== input.sessionId) {
    resolvePendingForegroundRun(context)
    clearForegroundRunState(context)
    return false
  }
  context.lastHydratedOptimisticKeyRef.current = keys.optimisticKey
  return true
}

function shouldSkipActiveRunHydration(
  input: SessionHydrationInput,
  keys: SessionHydrationKeys,
  context: SessionHydrationContext,
): boolean {
  return (
    context.backgroundReconnectSessionIdRef.current === input.sessionId &&
    !keys.sessionChanged &&
    !keys.snapshotChanged &&
    !keys.optimisticChanged
  )
}

function handleActiveRunReconnectResult(
  capturedSessionId: SessionId,
  nextMessages: UIMessage[] | null,
  context: SessionHydrationContext,
): void {
  if (
    !nextMessages ||
    context.currentSessionIdRef.current !== capturedSessionId ||
    context.backgroundReconnectSessionIdRef.current !== capturedSessionId
  ) {
    return
  }
  updateMessagesForSession(
    context.messagesBySessionIdRef,
    context.setMessagesBySessionId,
    context.setRunRenderMessages,
    capturedSessionId,
    (currentMessages) => mergeBackgroundReconnectMessages(nextMessages, currentMessages),
    { cacheRunSnapshot: true },
  )
}

function handleActiveRunReconnectError(
  capturedSessionId: SessionId,
  reconnectError: unknown,
  context: SessionHydrationContext,
): void {
  if (context.currentSessionIdRef.current !== capturedSessionId) {
    return
  }
  context.setError(
    reconnectError instanceof Error ? reconnectError : new Error(String(reconnectError)),
  )
  context.setStatus('error')
  context.setBackgroundStreaming(false)
  context.backgroundStreamingRef.current = false
}

function hydrateActiveRunSession(
  input: SessionHydrationInput,
  keys: SessionHydrationKeys,
  context: SessionHydrationContext,
): void {
  if (shouldSkipActiveRunHydration(input, keys, context)) {
    return
  }

  const persistedMessages = mergeSessionAndOptimisticMessages(
    input.session,
    input.optimisticUserMessages,
  )
  const nextMessages = input.cachedRenderMessages
    ? mergeBackgroundReconnectMessages([...persistedMessages], [...input.cachedRenderMessages])
    : reconcileSnapshotUserMessages(
        persistedMessages,
        getMessagesForSession(context.messagesBySessionIdRef, input.sessionId),
      )
  setMessagesForSession(
    context.messagesBySessionIdRef,
    context.setMessagesBySessionId,
    context.setRunRenderMessages,
    input.sessionId,
    nextMessages,
    { cacheRunSnapshot: true },
  )
  updateHydrationKeys(input.sessionId, keys, context)
  context.backgroundStreamingRef.current = true
  context.backgroundReconnectSessionIdRef.current = input.sessionId
  context.setBackgroundStreaming(true)
  context.setStatus('streaming')
  void reconnectToBackgroundRun(input.sessionId, input.session, input.optimisticUserMessages)
    .then((nextReconnectMessages) =>
      handleActiveRunReconnectResult(input.sessionId, nextReconnectMessages, context),
    )
    .catch((reconnectError: unknown) =>
      handleActiveRunReconnectError(input.sessionId, reconnectError, context),
    )
}

function hydrateIdleSession(
  input: SessionHydrationInput,
  keys: SessionHydrationKeys,
  context: SessionHydrationContext,
): void {
  context.setBackgroundStreaming(false)
  context.backgroundStreamingRef.current = false
  context.backgroundReconnectSessionIdRef.current = null

  if (!keys.sessionChanged && !keys.snapshotChanged && !keys.optimisticChanged) {
    return
  }

  const snapshotMessages = appendMissingOptimisticUserMessages(
    sessionToUIMessages(input.session),
    input.optimisticUserMessages,
  )
  setMessagesForSession(
    context.messagesBySessionIdRef,
    context.setMessagesBySessionId,
    context.setRunRenderMessages,
    input.sessionId,
    reconcileSnapshotUserMessages(
      snapshotMessages,
      getMessagesForSession(context.messagesBySessionIdRef, input.sessionId),
    ),
  )
  updateHydrationKeys(input.sessionId, keys, context)

  if (keys.sessionChanged) {
    context.setStatus('ready')
    context.setError(undefined)
  }
}

function hydrateSessionMessages(
  input: SessionHydrationInput,
  context: SessionHydrationContext,
): void {
  const keys = getSessionHydrationKeys(input, context)
  if (shouldKeepForegroundHydration(input, keys, context)) {
    return
  }
  resetSessionChangedState(keys, context)
  if (input.hasActiveRun) {
    hydrateActiveRunSession(input, keys, context)
    return
  }
  hydrateIdleSession(input, keys, context)
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
  const [status, setStatus] = useState<AgentChatStatus>('ready')
  const [error, setError] = useState<Error | undefined>(undefined)
  const [backgroundStreaming, setBackgroundStreaming] = useState(false)
  const [compactionStatus, setCompactionStatus] = useState<AgentCompactionStatus | null>(null)
  const messagesBySessionIdRef = useRef(messagesBySessionId)
  messagesBySessionIdRef.current = messagesBySessionId
  const messages = sessionId ? (messagesBySessionId.get(sessionId) ?? EMPTY_UI_MESSAGES) : []

  const isLoading =
    status === 'submitted' ||
    status === 'streaming' ||
    status === 'compacting' ||
    status === 'retrying' ||
    backgroundStreaming
  const isSessionIdle = !isLoading

  const currentSessionIdRef = useRef(sessionId)
  currentSessionIdRef.current = sessionId
  const statusRef = useRef(status)
  statusRef.current = status
  const backgroundStreamingRef = useRef(backgroundStreaming)
  backgroundStreamingRef.current = backgroundStreaming
  const messagesRef = useRef(messages)
  messagesRef.current = messages
  const foregroundStreamActiveRef = useRef(false)
  const foregroundSessionIdRef = useRef<SessionId | null>(null)
  const terminalRunErrorRef = useRef<Error | undefined>(undefined)
  const backgroundReconnectSessionIdRef = useRef<SessionId | null>(null)
  const streamSignalVersionRef = useRef(0)
  const deferredRefreshSessionIdRef = useRef<SessionId | null>(null)
  const deferredSnapshotRefreshCountRef = useRef(0)
  const lastHydratedSessionIdRef = useRef<SessionId | null>(null)
  const lastHydratedSnapshotKeyRef = useRef<string | null>(null)
  const lastHydratedOptimisticKeyRef = useRef<string | null>(null)
  const pendingRunWaiterRef = useRef<PendingRunWaiter | null>(null)
  const agentRunActionsRef = useRef<AgentRunActions | null>(null)

  const { visibleMessages, previewSteeredUserTurn } = useOptimisticSteeredTurn(
    messages,
    sessionId,
    isSessionIdle,
    buildClientUserMessage,
    messagesRef,
  )

  async function refreshSessionSnapshot(targetSessionId: SessionId): Promise<void> {
    const nextSession = await api.getSessionDetail(targetSessionId)
    if (!nextSession || currentSessionIdRef.current !== targetSessionId) {
      return
    }
    upsertSession(nextSession)
  }

  function flushDeferredSessionSnapshot(): void {
    if (deferredSnapshotRefreshCountRef.current > 0) {
      return
    }

    const targetSessionId = deferredRefreshSessionIdRef.current
    if (!targetSessionId) {
      return
    }
    if (currentSessionIdRef.current !== targetSessionId) {
      deferredRefreshSessionIdRef.current = null
      return
    }
    if (statusRef.current === 'submitted' || statusRef.current === 'streaming') {
      return
    }
    if (backgroundStreamingRef.current) {
      return
    }

    deferredRefreshSessionIdRef.current = null
    void refreshSessionSnapshot(targetSessionId)
  }

  async function withDeferredSnapshotRefresh<T>(operation: () => Promise<T>): Promise<T> {
    deferredSnapshotRefreshCountRef.current += 1
    try {
      return await operation()
    } finally {
      deferredSnapshotRefreshCountRef.current = Math.max(
        0,
        deferredSnapshotRefreshCountRef.current - 1,
      )
      flushDeferredSessionSnapshot()
    }
  }

  function settlePendingRun(nextError?: Error): void {
    const pending = pendingRunWaiterRef.current
    pendingRunWaiterRef.current = null
    if (!pending) {
      return
    }
    if (nextError) {
      pending.reject(nextError)
      return
    }
    pending.resolve()
  }

  function startForegroundRun(targetSessionId: SessionId): Promise<void> {
    const { promise, waiter } = createPendingRunWaiter()
    pendingRunWaiterRef.current = waiter
    foregroundStreamActiveRef.current = true
    foregroundSessionIdRef.current = targetSessionId
    terminalRunErrorRef.current = undefined
    setBackgroundStreaming(false)
    setError(undefined)
    setStatus('submitted')
    return promise
  }

  async function dispatchAgentSend(
    payload: AgentSendPayload,
    waggleConfig: WaggleConfig | null,
  ): Promise<void> {
    if (!sessionId) {
      return
    }

    const targetSessionId = sessionId
    const runPromise = startForegroundRun(targetSessionId)
    const sendPromise = waggleConfig
      ? api.sendWaggleMessage(targetSessionId, payload, waggleConfig)
      : api.sendMessage(targetSessionId, payload, model)

    try {
      await sendPromise
      await runPromise
    } catch (runError) {
      const normalizedError = runError instanceof Error ? runError : new Error(String(runError))
      if (foregroundSessionIdRef.current === targetSessionId) {
        pendingRunWaiterRef.current = null
        foregroundStreamActiveRef.current = false
        foregroundSessionIdRef.current = null
      }
      if (currentSessionIdRef.current === targetSessionId) {
        setError(normalizedError)
        setStatus('error')
        terminalRunErrorRef.current = normalizedError
      }
      throw normalizedError
    }
  }

  async function sendUserPayload(
    payload: AgentSendPayload,
    waggleConfig: WaggleConfig | null,
  ): Promise<void> {
    const optimisticUserMessage = createOptimisticUserMessage(payload)
    if (!sessionId) {
      return
    }

    const targetSessionId = sessionId
    addOptimisticUserMessage(targetSessionId, optimisticUserMessage)
    updateMessagesForSession(
      messagesBySessionIdRef,
      setMessagesBySessionId,
      setRunRenderMessages,
      targetSessionId,
      (currentMessages) => [...currentMessages, optimisticUserMessage],
      { cacheRunSnapshot: true },
    )
    await dispatchAgentSend(payload, waggleConfig)
  }

  agentRunActionsRef.current = {
    flushDeferredSessionSnapshot,
    settlePendingRun,
  }

  useEffect(() => {
    const hydrationContext: SessionHydrationContext = {
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
    }

    if (!sessionId || !session) {
      resetMissingSessionHydration(hydrationContext)
      return
    }

    const activeRun = hasActiveRun(sessionId)
    const cachedRenderSnapshot = activeRun ? getRunRenderSnapshot(sessionId) : null
    hydrateSessionMessages(
      {
        sessionId,
        session,
        optimisticUserMessages,
        hasActiveRun: activeRun,
        cachedRenderMessages: cachedRenderSnapshot?.messages ?? null,
      },
      hydrationContext,
    )
  }, [
    sessionId,
    session,
    hasActiveRun,
    getRunRenderSnapshot,
    setRunRenderMessages,
    optimisticUserMessages,
  ])

  useEffect(() => {
    if (!sessionId || !session || !isSessionIdle) {
      return
    }

    removeMatchedOptimisticUserMessages(sessionId, sessionToUIMessages(session))
  }, [sessionId, session, isSessionIdle, removeMatchedOptimisticUserMessages])

  useEffect(() => {
    if (!sessionId) {
      return
    }

    const subscribedSessionId = sessionId
    const streamEventContext: AgentStreamEventContext = {
      subscribedSessionId,
      currentSessionIdRef,
      foregroundStreamActiveRef,
      backgroundStreamingRef,
      backgroundReconnectSessionIdRef,
      streamSignalVersionRef,
      terminalRunErrorRef,
      messagesBySessionIdRef,
      setMessagesBySessionId,
      setRunRenderMessages,
      setError,
      setStatus,
      setCompactionStatus,
      setBackgroundStreaming,
    }
    const unsubscribeStream = api.onAgentEvent((payload) => {
      handleAgentStreamPayload(payload, streamEventContext)
    })

    const unsubscribeCompleted = api.onRunCompleted((payload) => {
      if (
        payload.sessionId !== subscribedSessionId ||
        currentSessionIdRef.current !== subscribedSessionId
      ) {
        return
      }

      const terminalError = terminalRunErrorRef.current
      foregroundStreamActiveRef.current = false
      foregroundSessionIdRef.current = null
      setBackgroundStreaming(false)
      backgroundStreamingRef.current = false
      backgroundReconnectSessionIdRef.current = null
      setCompactionStatus(null)
      if (!terminalError) {
        setStatus('ready')
      }
      agentRunActionsRef.current?.settlePendingRun(terminalError)
      terminalRunErrorRef.current = undefined
      deferredRefreshSessionIdRef.current = subscribedSessionId
      if (
        deferredSnapshotRefreshCountRef.current > 0 ||
        statusRef.current === 'submitted' ||
        statusRef.current === 'streaming' ||
        backgroundStreamingRef.current
      ) {
        return
      }
      agentRunActionsRef.current?.flushDeferredSessionSnapshot()
    })

    return () => {
      unsubscribeStream()
      unsubscribeCompleted()
    }
  }, [sessionId, setRunRenderMessages])

  useEffect(() => {
    if (!sessionId) {
      return
    }
    if (!isSessionIdle) {
      return
    }
    if (deferredRefreshSessionIdRef.current !== sessionId) {
      return
    }
    agentRunActionsRef.current?.flushDeferredSessionSnapshot()
  }, [sessionId, isSessionIdle])

  return {
    messages: visibleMessages,
    sendMessage: async (payload: AgentSendPayload) =>
      withDeferredSnapshotRefresh(async () => {
        await sendUserPayload(payload, null)
      }),
    sendWaggleMessage: async (payload: AgentSendPayload, config: WaggleConfig) =>
      withDeferredSnapshotRefresh(async () => {
        await sendUserPayload(payload, config)
      }),
    isLoading,
    status: backgroundStreaming ? 'streaming' : status,
    stop: () => {
      if (sessionId) {
        void api.cancelAgent(sessionId).catch((cancelError: unknown) => {
          const normalizedError =
            cancelError instanceof Error ? cancelError : new Error(String(cancelError))
          setError(normalizedError)
          setStatus('error')
          terminalRunErrorRef.current = normalizedError
        })
      }
      foregroundStreamActiveRef.current = false
      foregroundSessionIdRef.current = null
      terminalRunErrorRef.current = undefined
      settlePendingRun()
      setBackgroundStreaming(false)
      backgroundStreamingRef.current = false
      backgroundReconnectSessionIdRef.current = null
      setCompactionStatus(null)
      setStatus('ready')
    },
    steer: async () => {
      if (sessionId) {
        await api.steerAgent(sessionId)
      }
      foregroundStreamActiveRef.current = false
      foregroundSessionIdRef.current = null
      terminalRunErrorRef.current = undefined
      settlePendingRun()
      setBackgroundStreaming(false)
      backgroundStreamingRef.current = false
      backgroundReconnectSessionIdRef.current = null
      setCompactionStatus(null)
      setStatus('ready')
    },
    error,
    withDeferredSnapshotRefresh,
    previewSteeredUserTurn,
    backgroundStreaming,
    streamSignalVersion: streamSignalVersionRef.current,
    compactionStatus,
  }
}

async function reconnectToBackgroundRun(
  sessionId: SessionId,
  session: SessionDetail,
  optimisticUserMessages: readonly UIMessage[],
): Promise<UIMessage[] | null> {
  const latestSession = await api.getSessionDetail(sessionId)
  const snapshot = await api.getBackgroundRun(sessionId)
  const historicalMessages = mergeSessionAndOptimisticMessages(
    latestSession ?? session,
    optimisticUserMessages,
  )
  if (!snapshot) {
    return historicalMessages
  }

  const partialAssistant = buildPartialAssistantMessage(snapshot.parts, snapshot.messageId)
  return partialAssistant ? [...historicalMessages, partialAssistant] : historicalMessages
}

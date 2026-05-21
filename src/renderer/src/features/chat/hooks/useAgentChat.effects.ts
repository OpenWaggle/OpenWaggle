import type { SessionId } from '@shared/types/brand'
import type { UIMessage } from '@shared/types/chat-ui'
import type { IpcEventPayload } from '@shared/types/ipc'
import type { SessionDetail } from '@shared/types/session'
import { useEffect } from 'react'
import { api } from '@/shared/lib/ipc'
import { sessionToUIMessages } from '../lib/useAgentChat.utils'
import { hydrateSessionMessages, resetMissingSessionHydration } from './useAgentChat.hydration'
import { handleAgentStreamPayload } from './useAgentChat.stream-events'
import type {
  AgentRunActions,
  AgentStreamEventContext,
  MutableValueRef,
  SessionHydrationContext,
} from './useAgentChat.types'

interface UseSessionHydrationEffectsParams {
  readonly sessionId: SessionId | null
  readonly session: SessionDetail | null
  readonly isSessionIdle: boolean
  readonly optimisticUserMessages: readonly UIMessage[]
  readonly hasActiveRun: (sessionId: SessionId) => boolean
  readonly getRunRenderSnapshot: (
    sessionId: SessionId,
  ) => { readonly messages: readonly UIMessage[] } | null
  readonly removeMatchedOptimisticUserMessages: (
    sessionId: SessionId,
    persistedMessages: readonly UIMessage[],
  ) => void
  readonly context: SessionHydrationContext
}

interface UseAgentEventEffectsParams {
  readonly sessionId: SessionId | null
  readonly streamEventContext: Omit<AgentStreamEventContext, 'subscribedSessionId'>
  readonly runCompletionContext: RunCompletionEffectContext
}

interface RunCompletionContext {
  readonly subscribedSessionId: SessionId
  readonly currentSessionIdRef: MutableValueRef<SessionId | null>
  readonly foregroundStreamActiveRef: MutableValueRef<boolean>
  readonly foregroundSessionIdRef: MutableValueRef<SessionId | null>
  readonly terminalRunErrorRef: MutableValueRef<Error | undefined>
  readonly backgroundStreamingRef: MutableValueRef<boolean>
  readonly backgroundReconnectSessionIdRef: MutableValueRef<SessionId | null>
  readonly deferredRefreshSessionIdRef: MutableValueRef<SessionId | null>
  readonly deferredSnapshotRefreshCountRef: MutableValueRef<number>
  readonly statusRef: MutableValueRef<string>
  readonly setBackgroundStreaming: (backgroundStreaming: boolean) => void
  readonly setCompactionStatus: (status: null) => void
  readonly setStatus: (status: 'ready') => void
  readonly agentRunActionsRef: MutableValueRef<AgentRunActions | null>
}

export type RunCompletionEffectContext = Omit<RunCompletionContext, 'subscribedSessionId'>

function shouldIgnoreRunCompleted(
  payload: IpcEventPayload<'agent:run-completed'>,
  context: RunCompletionContext,
) {
  return (
    payload.sessionId !== context.subscribedSessionId ||
    context.currentSessionIdRef.current !== context.subscribedSessionId
  )
}

function shouldFlushCompletedRunSnapshot(context: RunCompletionContext) {
  return !(
    context.deferredSnapshotRefreshCountRef.current > 0 ||
    context.statusRef.current === 'submitted' ||
    context.statusRef.current === 'streaming' ||
    context.backgroundStreamingRef.current
  )
}

function handleRunCompletedPayload(
  payload: IpcEventPayload<'agent:run-completed'>,
  context: RunCompletionContext,
) {
  if (shouldIgnoreRunCompleted(payload, context)) {
    return
  }

  const terminalError = context.terminalRunErrorRef.current
  context.foregroundStreamActiveRef.current = false
  context.foregroundSessionIdRef.current = null
  context.setBackgroundStreaming(false)
  context.backgroundStreamingRef.current = false
  context.backgroundReconnectSessionIdRef.current = null
  context.setCompactionStatus(null)
  if (!terminalError) {
    context.setStatus('ready')
  }
  context.agentRunActionsRef.current?.settlePendingRun(terminalError)
  context.terminalRunErrorRef.current = undefined
  context.deferredRefreshSessionIdRef.current = context.subscribedSessionId
  if (shouldFlushCompletedRunSnapshot(context)) {
    context.agentRunActionsRef.current?.flushDeferredSessionSnapshot()
  }
}

export function useSessionHydrationEffects(params: UseSessionHydrationEffectsParams) {
  const {
    sessionId,
    session,
    isSessionIdle,
    optimisticUserMessages,
    hasActiveRun,
    getRunRenderSnapshot,
    removeMatchedOptimisticUserMessages,
    context,
  } = params

  useEffect(() => {
    if (!sessionId || !session) {
      resetMissingSessionHydration(context)
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
      context,
    )
  }, [sessionId, session, hasActiveRun, getRunRenderSnapshot, optimisticUserMessages, context])

  useEffect(() => {
    if (!sessionId || !session || !isSessionIdle) {
      return
    }

    removeMatchedOptimisticUserMessages(sessionId, sessionToUIMessages(session))
  }, [sessionId, session, isSessionIdle, removeMatchedOptimisticUserMessages])
}

export function useAgentEventEffects(params: UseAgentEventEffectsParams) {
  const { sessionId, streamEventContext, runCompletionContext } = params

  useEffect(() => {
    if (!sessionId) {
      return
    }

    const subscribedSessionId = sessionId
    const unsubscribeStream = api.onAgentEvent((payload) => {
      handleAgentStreamPayload(payload, { ...streamEventContext, subscribedSessionId })
    })
    const unsubscribeCompleted = api.onRunCompleted((payload) => {
      handleRunCompletedPayload(payload, { ...runCompletionContext, subscribedSessionId })
    })

    return () => {
      unsubscribeStream()
      unsubscribeCompleted()
    }
  }, [sessionId, streamEventContext, runCompletionContext])

  useEffect(() => {
    if (!sessionId) {
      return
    }
    if (runCompletionContext.deferredRefreshSessionIdRef.current !== sessionId) {
      return
    }
    runCompletionContext.agentRunActionsRef.current?.flushDeferredSessionSnapshot()
  }, [sessionId, runCompletionContext])
}

import type { SessionId } from '@shared/types/brand'
import type { UIMessage } from '@shared/types/chat-ui'
import type { AgentErrorInfo } from '@shared/types/errors'
import { restoreLastAgentErrorInfo } from '../lib/agent-error-store'
import type {
  AgentChatStatus,
  MutableValueRef,
  PendingRunWaiter,
  SetMessagesBySessionId,
  SetRunRenderMessages,
} from './useAgentChat.types'

export interface ForegroundRunRefs {
  readonly currentSessionIdRef: MutableValueRef<SessionId | null>
  readonly statusRef: MutableValueRef<AgentChatStatus>
  readonly foregroundStreamActiveRef: MutableValueRef<boolean>
  readonly foregroundSessionIdRef: MutableValueRef<SessionId | null>
  readonly terminalRunErrorRef: MutableValueRef<Error | undefined>
  readonly pendingRunWaiterRef: MutableValueRef<PendingRunWaiter | null>
  readonly messagesBySessionIdRef: MutableValueRef<Map<SessionId, UIMessage[]>>
}

export interface ForegroundRunSetters {
  readonly error: Error | undefined
  readonly setError: (error: Error | undefined) => void
  readonly setStatus: (status: AgentChatStatus) => void
  readonly setBackgroundStreaming: (backgroundStreaming: boolean) => void
  readonly setMessagesBySessionId: SetMessagesBySessionId
  readonly setRunRenderMessages: SetRunRenderMessages
  readonly removeOptimisticUserMessage: (sessionId: SessionId, messageId: UIMessage['id']) => void
}

/** What the renderer was following when a send began, so a send that started nothing can hand it back. */
export interface ForegroundRunState {
  readonly waiter: PendingRunWaiter | null
  readonly foregroundStreamActive: boolean
  readonly foregroundSessionId: SessionId | null
  readonly terminalRunError: Error | undefined
  readonly status: AgentChatStatus
  readonly error: Error | undefined
  /** The banner's details for `error`, which a failure meanwhile would otherwise overwrite. */
  readonly errorInfo: AgentErrorInfo | null
}

/**
 * A refused send's own failure is not shown: what was on screen before it comes back, unless a
 * real event (a wake's stream) took over meanwhile. Whether it restored.
 */
export function restoreBeforeRefusedSend(
  refs: ForegroundRunRefs,
  previous: ForegroundRunState,
  setters: ForegroundRunSetters,
  sessionId: SessionId,
) {
  const status = refs.statusRef.current
  if (status !== 'submitted' && status !== 'ready' && status !== 'error') return false
  // The banner reads its text from the stored details, so they go back with the error.
  restoreLastAgentErrorInfo(sessionId, previous.errorInfo)
  refs.terminalRunErrorRef.current = previous.terminalRunError
  setters.setError(previous.error)
  setters.setStatus(previous.status)
  return true
}

export function restoreVisibleRunState(
  refs: ForegroundRunRefs,
  previous: ForegroundRunState,
  completedMeanwhile: boolean,
  setters: ForegroundRunSetters,
) {
  // Anything other than the send's own `submitted` (or the `ready` a completion set) came from a
  // real event that arrived meanwhile, and wins.
  const status = refs.statusRef.current
  if (!completedMeanwhile && status === 'submitted') {
    setters.setError(previous.error)
    setters.setStatus(previous.status)
    return
  }
  if (completedMeanwhile && (status === 'submitted' || status === 'ready')) {
    const error = previous.error ?? previous.terminalRunError
    setters.setError(error)
    setters.setStatus(error ? 'error' : 'ready')
  }
}

/**
 * Gives the foreground back to what the send displaced, unless a later send that began meanwhile
 * owns it: what is on screen is then its own. Whether a later send owns it.
 */
export function handBackForegroundPointers(
  refs: ForegroundRunRefs,
  tracked: PendingRunWaiter,
  previous: ForegroundRunState,
) {
  const current = refs.pendingRunWaiterRef.current
  if (current !== tracked) return current !== null
  refs.pendingRunWaiterRef.current = previous.waiter
  refs.foregroundStreamActiveRef.current = previous.foregroundStreamActive
  refs.foregroundSessionIdRef.current = previous.foregroundSessionId
  refs.terminalRunErrorRef.current ??= previous.terminalRunError
  return false
}

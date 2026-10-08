import type { SessionId } from '@shared/types/brand'
import type { UIMessage } from '@shared/types/chat-ui'
import { settlingRunId } from '../lib/run-ids'
import { createPendingRunWaiter, updateMessagesForSession } from './useAgentChat.message-cache'
import type {
  AgentChatStatus,
  MutableValueRef,
  PendingRunWaiter,
  RunCompletion,
  RunCompletionRouting,
  SetMessagesBySessionId,
  SetRunRenderMessages,
} from './useAgentChat.types'

interface ForegroundRunRefs {
  readonly currentSessionIdRef: MutableValueRef<SessionId | null>
  readonly statusRef: MutableValueRef<AgentChatStatus>
  readonly foregroundStreamActiveRef: MutableValueRef<boolean>
  readonly foregroundSessionIdRef: MutableValueRef<SessionId | null>
  readonly terminalRunErrorRef: MutableValueRef<Error | undefined>
  readonly pendingRunWaiterRef: MutableValueRef<PendingRunWaiter | null>
  readonly messagesBySessionIdRef: MutableValueRef<Map<SessionId, UIMessage[]>>
}

interface ForegroundRunSetters {
  readonly error: Error | undefined
  readonly setError: (error: Error | undefined) => void
  readonly setStatus: (status: AgentChatStatus) => void
  readonly setBackgroundStreaming: (backgroundStreaming: boolean) => void
  readonly setMessagesBySessionId: SetMessagesBySessionId
  readonly setRunRenderMessages: SetRunRenderMessages
  readonly removeOptimisticUserMessage: (sessionId: SessionId, messageId: UIMessage['id']) => void
}

/** What the renderer was following when a send began, so a send that started nothing can hand it back. */
interface ForegroundRunState {
  readonly waiter: PendingRunWaiter | null
  readonly foregroundStreamActive: boolean
  readonly foregroundSessionId: SessionId | null
  readonly terminalRunError: Error | undefined
  readonly status: AgentChatStatus
  readonly error: Error | undefined
}

/** Offer a completion to a waiter, which may route it on; one without routing just settles. */
export function offerRunCompletion(
  waiter: PendingRunWaiter,
  completion: RunCompletion,
): RunCompletionRouting {
  if (waiter.complete) return waiter.complete(completion)
  if (completion.error) waiter.reject(completion.error)
  else waiter.resolve()
  return 'settled'
}

/**
 * The waiter a send installs before it knows whether the Host started a Run for it.
 *
 * It has to be installed first - the Run's events can arrive before the invoke resolves - so it
 * displaces whatever the renderer was already following. When the Host queues the message instead,
 * `handBack` returns that displaced state: a completion that lands on this waiter afterwards, or that
 * already landed on it, belongs to the Run that was still settling and is forwarded to its waiter.
 *
 * When the Host starts a Run, `bind` names it. From then on only that Run's completion settles this
 * send; another Run's completion (the earlier Run settling just after this send began) is forwarded
 * to the send it belongs to. A completion that arrives before the Run is known is held until then.
 */
function createForegroundRunWaiter(previous: ForegroundRunState) {
  const { promise, waiter } = createPendingRunWaiter()
  let settled: { readonly error: Error | undefined } | null = null
  let handedBack = false
  // undefined: not known yet; null: the Host did not name it, so any completion is this send's.
  let boundRunId: string | null | undefined
  const held: RunCompletion[] = []

  function forwardToPrevious(completion: RunCompletion) {
    // The completion was read after this send reset the terminal error, so it may lack the
    // failure the earlier Run had already reported.
    const error = completion.error ?? previous.terminalRunError
    if (!previous.waiter) return
    offerRunCompletion(previous.waiter, { ...completion, ...(error ? { error } : {}) })
  }

  function settle(error: Error | undefined) {
    if (settled) return
    settled = { error }
    if (error) waiter.reject(error)
    else waiter.resolve()
    if (handedBack) forwardToPrevious(error ? { error } : {})
  }

  function route(completion: RunCompletion): RunCompletionRouting {
    if (handedBack) {
      forwardToPrevious(completion)
      return 'forwarded'
    }
    if (completion.runId === undefined || boundRunId === null) {
      settle(completion.error)
      return 'settled'
    }
    if (boundRunId === undefined) {
      held.push(completion)
      return 'held'
    }
    // A requested Waggle's id (`waggle-of-<X>`) settles as the classic Run X it goes on with.
    if (settlingRunId(completion.runId) === boundRunId) {
      settle(completion.error)
      return 'settled'
    }
    forwardToPrevious(completion)
    return 'forwarded'
  }

  const tracked: PendingRunWaiter = {
    resolve: () => settle(undefined),
    reject: (error) => settle(error),
    complete: route,
  }

  function bind(runId: string | undefined) {
    boundRunId = runId ?? null
    for (const completion of held.splice(0)) route(completion)
  }

  function handBack(
    refs: ForegroundRunRefs,
    targetSessionId: SessionId,
    setters: ForegroundRunSetters,
  ) {
    handedBack = true
    const completedMeanwhile = settled !== null || held.length > 0
    if (settled) forwardToPrevious(settled.error ? { error: settled.error } : {})
    for (const completion of held.splice(0)) forwardToPrevious(completion)
    if (refs.pendingRunWaiterRef.current === tracked) {
      refs.pendingRunWaiterRef.current = previous.waiter
      refs.foregroundStreamActiveRef.current = previous.foregroundStreamActive
      refs.foregroundSessionIdRef.current = previous.foregroundSessionId
      refs.terminalRunErrorRef.current ??= previous.terminalRunError
    }
    if (refs.currentSessionIdRef.current !== targetSessionId) return
    restoreVisibleRunState(refs, previous, completedMeanwhile, setters)
  }

  return { promise, waiter: tracked, bind, handBack }
}

function restoreVisibleRunState(
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

export type ForegroundRun = ReturnType<typeof createForegroundRunWaiter>

/** Follow the Run a send is about to start, remembering what it displaces. */
export function beginForegroundRun(
  refs: ForegroundRunRefs,
  setters: ForegroundRunSetters,
  targetSessionId: SessionId,
): ForegroundRun {
  const run = createForegroundRunWaiter({
    waiter: refs.pendingRunWaiterRef.current,
    foregroundStreamActive: refs.foregroundStreamActiveRef.current,
    foregroundSessionId: refs.foregroundSessionIdRef.current,
    terminalRunError: refs.terminalRunErrorRef.current,
    status: refs.statusRef.current,
    error: setters.error,
  })
  refs.pendingRunWaiterRef.current = run.waiter
  refs.foregroundStreamActiveRef.current = true
  refs.foregroundSessionIdRef.current = targetSessionId
  refs.terminalRunErrorRef.current = undefined
  setters.setBackgroundStreaming(false)
  setters.setError(undefined)
  setters.setStatus('submitted')
  return run
}

/**
 * The Host kept the message as a Follow-up rather than starting a Run - the Session still had a Run
 * settling, or Follow-ups waiting in a queue a failed Run paused. Nothing will complete for this
 * send, so the Session goes back to what it was showing, and the message leaves the transcript: it
 * is a queued Follow-up now, shown in the queue with a way to resume it. If the Host has already
 * started it as the next Run, its row is that Run's incorporated user message and stays.
 */
export function forgetQueuedSend(input: {
  readonly refs: ForegroundRunRefs
  readonly setters: ForegroundRunSetters
  readonly targetSessionId: SessionId
  readonly run: ForegroundRun
  readonly optimisticMessageId: UIMessage['id']
}) {
  const { refs, setters, targetSessionId, optimisticMessageId } = input
  input.run.handBack(refs, targetSessionId, setters)
  setters.removeOptimisticUserMessage(targetSessionId, optimisticMessageId)
  updateMessagesForSession(
    refs.messagesBySessionIdRef,
    setters.setMessagesBySessionId,
    setters.setRunRenderMessages,
    targetSessionId,
    // A row that took a log order is a message the Host already started as the next Run's input.
    (currentMessages) =>
      currentMessages.filter(
        (message) =>
          message.id !== optimisticMessageId ||
          message.metadata?.sessionNodeCreatedOrder !== undefined,
      ),
    { cacheRunSnapshot: true },
  )
}

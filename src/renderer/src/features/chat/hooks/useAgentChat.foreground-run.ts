import type { SessionId } from '@shared/types/brand'
import type { UIMessage } from '@shared/types/chat-ui'
import { settlingRunId } from '../lib/run-ids'
import { createPendingRunWaiter } from './useAgentChat.message-cache'
import type {
  AgentChatStatus,
  MutableValueRef,
  PendingRunWaiter,
  RunCompletion,
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
interface ForegroundRunState {
  readonly waiter: PendingRunWaiter | null
  readonly foregroundStreamActive: boolean
  readonly foregroundSessionId: SessionId | null
  readonly terminalRunError: Error | undefined
  readonly status: AgentChatStatus
  readonly error: Error | undefined
}

export function normalizeError(error: unknown) {
  return error instanceof Error ? error : new Error(String(error))
}

/** The renderer follows no Run in the foreground any more. */
export function clearRunPointers(refs: ForegroundRunRefs) {
  refs.foregroundStreamActiveRef.current = false
  refs.foregroundSessionIdRef.current = null
  refs.terminalRunErrorRef.current = undefined
}

/** Offer a completion to a waiter, which may route it on; one without routing just settles. */
export function offerRunCompletion(waiter: PendingRunWaiter, completion: RunCompletion) {
  if (waiter.complete) return waiter.complete(completion)
  if (completion.error) waiter.reject(completion.error)
  else waiter.resolve()
  return 'settled' as const
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
function createForegroundRunWaiter(displaced: ForegroundRunState) {
  // Replaced when the send this one displaced ends without a Run: this send then displaced what
  // that one had (`spliceOut`).
  let previous = displaced
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
    const routing = offerRunCompletion(previous.waiter, {
      ...completion,
      ...(error ? { error } : {}),
    })
    // That Run has ended: handed back, its waiter would be followed again, and the next Run this
    // renderer did not send would be offered to it, dropped, and left on Stop after it ended.
    if (routing === 'settled') {
      displacedBy.delete(previous.waiter)
      previous = {
        ...previous,
        waiter: null,
        foregroundStreamActive: false,
        foregroundSessionId: null,
      }
    }
  }

  function settle(error: Error | undefined) {
    if (settled) return
    settled = { error }
    if (error) waiter.reject(error)
    else waiter.resolve()
    if (handedBack) forwardToPrevious(error ? { error } : {})
  }

  function route(completion: RunCompletion) {
    if (handedBack) {
      forwardToPrevious(completion)
      return 'forwarded' as const
    }
    if (completion.runId === undefined || boundRunId === null) {
      settle(completion.error)
      return 'settled' as const
    }
    if (boundRunId === undefined) {
      held.push(completion)
      return 'held' as const
    }
    // A requested Waggle's id (`waggle-of-<X>`) settles as the classic Run X it goes on with.
    if (settlingRunId(completion.runId) === boundRunId) {
      settle(completion.error)
      return 'settled' as const
    }
    forwardToPrevious(completion)
    return 'forwarded' as const
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
    const ownsForeground = refs.pendingRunWaiterRef.current === tracked
    if (ownsForeground) {
      if (previous.waiter) displacedBy.delete(previous.waiter)
      refs.pendingRunWaiterRef.current = previous.waiter
      refs.foregroundStreamActiveRef.current = previous.foregroundStreamActive
      refs.foregroundSessionIdRef.current = previous.foregroundSessionId
      refs.terminalRunErrorRef.current ??= previous.terminalRunError
    }
    // A later send that owns the foreground owns the status too: its `submitted` is not ours.
    const laterSendOwnsForeground = !ownsForeground && refs.pendingRunWaiterRef.current !== null
    if (laterSendOwnsForeground) spliceOut()
    if (laterSendOwnsForeground || refs.currentSessionIdRef.current !== targetSessionId) return
    restoreVisibleRunState(refs, previous, completedMeanwhile, setters)
  }

  /**
   * Takes this send, which ends without a Run, out of the chain: the later send that displaced it
   * now displaces what this one did. Left in, that send handed back this one's `submitted` and
   * its spent waiter, and the Session kept showing "Thinking" over nothing.
   */
  function spliceOut() {
    const later = displacedBy.get(tracked)
    if (later) {
      later.replacePrevious(previous)
      // The later send now displaces what this one did, so a send this one displaced, ending
      // without a Run in turn, hands its own state on to it.
      if (previous.waiter) displacedBy.set(previous.waiter, later)
    }
    displacedBy.delete(tracked)
  }

  function replacePrevious(next: ForegroundRunState) {
    previous = next
  }

  displacedOf.set(tracked, () => previous.waiter)

  /** Whether this send displaced an earlier send still waiting on its Run. */
  function displacesPendingSend() {
    return previous.waiter !== null
  }

  return {
    promise,
    waiter: tracked,
    bind,
    handBack,
    spliceOut,
    replacePrevious,
    displacesPendingSend,
  }
}

/** Each pending send's waiter, to the later send that displaced it from the foreground. */
const displacedBy = new WeakMap<PendingRunWaiter, ForegroundRun>()
/** Each send's waiter, to the Session it was sent to. */
const sentToSession = new WeakMap<PendingRunWaiter, SessionId>()

/**
 * Whether `waiter` is a send to a Session other than `sessionId`. A completion the send held
 * (an earlier Run's, before the send knew its own) clears the foreground state while the send is
 * still in flight, so a switch away has only this to know that the send belongs to another Session.
 */
export function isSendToOtherSession(waiter: PendingRunWaiter, sessionId: SessionId) {
  const sentTo = sentToSession.get(waiter)
  return sentTo !== undefined && sentTo !== sessionId
}

/** Each send's waiter, to the waiter of the earlier send it displaced, while that one waits. */
const displacedOf = new WeakMap<PendingRunWaiter, () => PendingRunWaiter | null>()

/**
 * Settles every earlier send the followed `waiter` displaced, once the Session stops being
 * followed (Stop, a switch away). Only the followed send was settled before, so an earlier one
 * whose Run was still settling waited forever, and the Session's pickers stayed locked behind it.
 */
export function settleDisplacedSends(waiter: PendingRunWaiter | null) {
  let next = waiter ? (displacedOf.get(waiter)?.() ?? null) : null
  while (next) {
    const earlier = next
    next = displacedOf.get(earlier)?.() ?? null
    earlier.resolve()
  }
}

/** Stop: the followed send settles, and so does every earlier send it displaced. */
export function stopFollowingSends(refs: Pick<ForegroundRunRefs, 'pendingRunWaiterRef'>) {
  const pending = refs.pendingRunWaiterRef.current
  if (!pending) return
  if (
    offerRunCompletion(pending, {}) === 'settled' &&
    refs.pendingRunWaiterRef.current === pending
  ) {
    refs.pendingRunWaiterRef.current = null
  }
  settleDisplacedSends(pending)
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
) {
  const displacedWaiter = refs.pendingRunWaiterRef.current
  const run = createForegroundRunWaiter({
    waiter: displacedWaiter,
    foregroundStreamActive: refs.foregroundStreamActiveRef.current,
    foregroundSessionId: refs.foregroundSessionIdRef.current,
    terminalRunError: refs.terminalRunErrorRef.current,
    status: refs.statusRef.current,
    error: setters.error,
  })
  if (displacedWaiter) displacedBy.set(displacedWaiter, run)
  sentToSession.set(run.waiter, targetSessionId)
  refs.pendingRunWaiterRef.current = run.waiter
  refs.foregroundStreamActiveRef.current = true
  refs.foregroundSessionIdRef.current = targetSessionId
  refs.terminalRunErrorRef.current = undefined
  setters.setBackgroundStreaming(false)
  setters.setError(undefined)
  setters.setStatus('submitted')
  return run
}

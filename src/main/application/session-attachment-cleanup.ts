import * as Cause from 'effect/Cause'
import * as Effect from 'effect/Effect'
import * as FiberRef from 'effect/FiberRef'
import { createLogger } from '../logger'
import { SessionControlAttachmentService } from '../ports/session-control-attachment-service'

const logger = createLogger('session-control/attachment-cleanup')

interface SessionAttachmentTransitionWaiter {
  readonly resume: (effect: Effect.Effect<() => void, Error>) => void
  readonly signal?: AbortSignal
  readonly onAbort?: () => void
  readonly settlingRunId?: string
}

interface SessionAttachmentTransitionState {
  locked: boolean
  readonly waiters: SessionAttachmentTransitionWaiter[]
}

const sessionAttachmentTransitions = new Map<string, SessionAttachmentTransitionState>()
/**
 * Session id -> Run id -> open loan count. A transition holder that waits for one Run to settle
 * lends its grant to that Run's teardown, which would otherwise queue behind the holder forever.
 */
const sessionAttachmentTransitionLoans = new Map<string, Map<string, number>>()
const releaseBorrowedSessionAttachmentTransition = () => undefined
const emptySessionAttachmentTransitions = new Set<string>()
const heldSessionAttachmentTransitions = FiberRef.unsafeMake<ReadonlySet<string>>(
  emptySessionAttachmentTransitions,
  {
    // A child fiber may outlive the protected transition. It must acquire its own lock rather than
    // inheriting a re-entrancy grant that stops being valid when the parent releases the lock.
    fork: () => emptySessionAttachmentTransitions,
    join: (parent) => parent,
  },
)

function transitionCancellationError() {
  return new Error('Pending explicit Waggle run was cancelled.')
}

function removeWaiterAbortListener(waiter: SessionAttachmentTransitionWaiter) {
  if (waiter.signal && waiter.onAbort) {
    waiter.signal.removeEventListener('abort', waiter.onAbort)
  }
}

function removeSessionAttachmentTransitionWaiter(
  state: SessionAttachmentTransitionState,
  waiter: SessionAttachmentTransitionWaiter,
) {
  const index = state.waiters.indexOf(waiter)
  if (index < 0) return false
  state.waiters.splice(index, 1)
  removeWaiterAbortListener(waiter)
  return true
}

function grantNextSessionAttachmentTransition(
  sessionId: string,
  state: SessionAttachmentTransitionState,
) {
  while (state.waiters.length > 0) {
    const waiter = state.waiters.shift()
    if (!waiter) break
    removeWaiterAbortListener(waiter)
    if (waiter.signal?.aborted) {
      waiter.resume(Effect.fail(transitionCancellationError()))
      continue
    }
    state.locked = true
    let released = false
    waiter.resume(
      Effect.succeed(() => {
        if (released) return
        released = true
        grantNextSessionAttachmentTransition(sessionId, state)
      }),
    )
    return
  }
  state.locked = false
  if (sessionAttachmentTransitions.get(sessionId) === state) {
    sessionAttachmentTransitions.delete(sessionId)
  }
}

function isSessionAttachmentTransitionLent(sessionId: string, runId: string | undefined) {
  return runId !== undefined && sessionAttachmentTransitionLoans.get(sessionId)?.has(runId) === true
}

function openSessionAttachmentTransitionLoan(sessionId: string, runId: string) {
  const loans = sessionAttachmentTransitionLoans.get(sessionId) ?? new Map<string, number>()
  loans.set(runId, (loans.get(runId) ?? 0) + 1)
  sessionAttachmentTransitionLoans.set(sessionId, loans)
  // The Run's teardown may already be queued behind the lender; admit it under the loan.
  const state = sessionAttachmentTransitions.get(sessionId)
  for (const waiter of [...(state?.waiters ?? [])]) {
    if (!state || waiter.settlingRunId !== runId) continue
    if (!removeSessionAttachmentTransitionWaiter(state, waiter)) continue
    waiter.resume(Effect.succeed(releaseBorrowedSessionAttachmentTransition))
  }
}

function closeSessionAttachmentTransitionLoan(sessionId: string, runId: string) {
  const loans = sessionAttachmentTransitionLoans.get(sessionId)
  const count = loans?.get(runId) ?? 0
  if (!loans || count === 0) return
  if (count > 1) loans.set(runId, count - 1)
  else loans.delete(runId)
  if (loans.size === 0) sessionAttachmentTransitionLoans.delete(sessionId)
}

function acquireSessionAttachmentTransition(
  sessionId: string,
  signal?: AbortSignal,
  settlingRunId?: string,
) {
  return Effect.async<() => void, Error>((resume) => {
    if (signal?.aborted) {
      resume(Effect.fail(transitionCancellationError()))
      return
    }
    if (isSessionAttachmentTransitionLent(sessionId, settlingRunId)) {
      resume(Effect.succeed(releaseBorrowedSessionAttachmentTransition))
      return
    }
    const state = sessionAttachmentTransitions.get(sessionId) ?? { locked: false, waiters: [] }
    sessionAttachmentTransitions.set(sessionId, state)
    let waiter: SessionAttachmentTransitionWaiter
    if (signal) {
      const onAbort = () => {
        if (!removeSessionAttachmentTransitionWaiter(state, waiter)) return
        resume(Effect.fail(transitionCancellationError()))
      }
      waiter = { resume, signal, onAbort, ...(settlingRunId ? { settlingRunId } : {}) }
    } else {
      waiter = { resume, ...(settlingRunId ? { settlingRunId } : {}) }
    }
    if (!state.locked && state.waiters.length === 0) {
      state.waiters.push(waiter)
      grantNextSessionAttachmentTransition(sessionId, state)
      return
    }
    state.waiters.push(waiter)
    if (signal && waiter.onAbort) {
      signal.addEventListener('abort', waiter.onAbort, { once: true })
      if (signal.aborted) waiter.onAbort()
    }
    return Effect.sync(() => removeSessionAttachmentTransitionWaiter(state, waiter))
  })
}

/**
 * Serializes the short interval in which Session attachments move from bound capabilities to a
 * durable Run intent against cleanup from the preceding operation. The protected effect must end
 * once its durable intent exists; callers must not hold this semaphore while waiting on a Pi writer
 * unless they lend it to that writer with `lendSessionAttachmentTransitionToSettlingRun`.
 *
 * `settlingRunId` names the Run whose teardown this is, so a holder waiting on that Run's
 * settlement can admit it.
 */
export function withSessionAttachmentTransition<A, E, R>(input: {
  readonly sessionId: string
  readonly effect: Effect.Effect<A, E, R>
  readonly signal?: AbortSignal
  readonly settlingRunId?: string
}) {
  return FiberRef.get(heldSessionAttachmentTransitions).pipe(
    Effect.flatMap((heldTransitions) => {
      if (heldTransitions.has(input.sessionId)) return input.effect
      const nextHeldTransitions = new Set(heldTransitions).add(input.sessionId)
      return Effect.uninterruptibleMask((restore) =>
        restore(
          acquireSessionAttachmentTransition(input.sessionId, input.signal, input.settlingRunId),
        ).pipe(
          Effect.flatMap((release) =>
            restore(
              Effect.locally(input.effect, heldSessionAttachmentTransitions, nextHeldTransitions),
            ).pipe(Effect.ensuring(Effect.sync(release))),
          ),
        ),
      )
    }),
  )
}

/**
 * Wait for a Run to settle while this fiber holds the Session's attachment transition. The Run's
 * teardown releases its attachments under the same transition, so waiting without a loan is a
 * deadlock. The loan admits only that Run's teardown; the holder is parked on its settlement, and
 * every other operation stays excluded. Without a held transition the effect runs unchanged.
 */
export function lendSessionAttachmentTransitionToSettlingRun<A, E, R>(input: {
  readonly sessionId: string
  readonly runId: string
  readonly effect: Effect.Effect<A, E, R>
}) {
  return FiberRef.get(heldSessionAttachmentTransitions).pipe(
    Effect.flatMap((heldTransitions) =>
      heldTransitions.has(input.sessionId)
        ? Effect.acquireUseRelease(
            Effect.sync(() => openSessionAttachmentTransitionLoan(input.sessionId, input.runId)),
            () => input.effect,
            () =>
              Effect.sync(() => closeSessionAttachmentTransitionLoan(input.sessionId, input.runId)),
          )
        : input.effect,
    ),
  )
}

export function releaseSessionControlAttachments(input: {
  readonly attachmentIds: readonly string[]
  readonly sessionId: string
  readonly ownerCallerId: string
}) {
  return withSessionAttachmentTransition({
    sessionId: input.sessionId,
    effect: SessionControlAttachmentService.pipe(
      Effect.flatMap((service) => service.release(input)),
    ),
  })
}

export function preserveOutcomeAfterAttachmentCleanup<A, E, R, E2, R2>(input: {
  readonly effect: Effect.Effect<A, E, R>
  readonly cleanup: Effect.Effect<void, E2, R2>
  readonly operation: 'command' | 'promotion' | 'run'
  readonly sessionId: string
}) {
  const cleanup = input.cleanup.pipe(
    Effect.catchAllCause((cause) =>
      Effect.sync(() => {
        logger.error('Attachment cleanup failed after the authoritative outcome was decided.', {
          cause: Cause.pretty(cause),
          operation: input.operation,
          sessionId: input.sessionId,
        })
      }),
    ),
  )
  return input.effect.pipe(Effect.ensuring(cleanup))
}

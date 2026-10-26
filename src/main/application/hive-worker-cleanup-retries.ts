import type { SessionId } from '@shared/types/brand'
import type { SessionControlMutationResponse } from '@shared/types/session-control'
import * as Effect from 'effect/Effect'

export interface HiveWorkerCleanupPass {
  readonly archived: readonly SessionControlMutationResponse[]
  /** Workers kept by live desktop state: nothing tells the Host when that state clears. */
  readonly keptByDesktop: readonly SessionId[]
}

const SECOND_MS = 1_000
/** Backoff for a Worker that live desktop state keeps; the last delay repeats while it is kept. */
export const DEFAULT_KEPT_RETRY_DELAYS_MS = [
  15 * SECOND_MS,
  30 * SECOND_MS,
  60 * SECOND_MS,
  120 * SECOND_MS,
  300 * SECOND_MS,
] as const
/** Bounds the retry timers one Host keeps; a Worker past it waits for the next ordinary trigger. */
const MAX_KEPT_WORKER_RETRIES = 256

/**
 * A Worker kept because it is open in the app, has a terminal, or runs a service gets no Host
 * trigger when the user closes that, so the background strategy re-checks it on a backoff until
 * it is archived or stops being eligible (issue #352).
 */
export function makeKeptWorkerRetries(
  delaysMs: readonly number[],
  reconcile: (sessionId: SessionId) => Effect.Effect<void>,
) {
  const attempts = new Map<SessionId, number>()
  const delayFor = (attempt: number) =>
    delaysMs[Math.min(attempt, delaysMs.length - 1)] ?? DEFAULT_KEPT_RETRY_DELAYS_MS[0]
  return {
    /** A failed pass schedules nothing, so the next ordinary trigger may retry it afresh. */
    forget: (sessionId: SessionId) => Effect.sync(() => attempts.delete(sessionId)),
    afterPass: (sessionId: SessionId, pass: HiveWorkerCleanupPass) =>
      Effect.gen(function* () {
        const kept = new Set(pass.keptByDesktop)
        // A pass for the Worker itself that no longer keeps it ends its retries.
        if (!kept.has(sessionId)) attempts.delete(sessionId)
        for (const workerSessionId of kept) {
          if (attempts.has(workerSessionId) && workerSessionId !== sessionId) continue
          if (!attempts.has(workerSessionId) && attempts.size >= MAX_KEPT_WORKER_RETRIES) continue
          const attempt = attempts.get(workerSessionId) ?? 0
          attempts.set(workerSessionId, attempt + 1)
          yield* Effect.sleep(delayFor(attempt)).pipe(
            Effect.zipRight(reconcile(workerSessionId)),
            Effect.forkDaemon,
          )
        }
      }),
  }
}

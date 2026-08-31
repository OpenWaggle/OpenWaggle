import * as Effect from 'effect/Effect'

const CONCURRENT_READ_PERMITS = 0x7fffffff

export interface EffectReadWriteGate {
  readonly read: <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>
  readonly write: <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>
}

/**
 * A writer-preferring gate for Effects. Readers run concurrently, while a writer holds the
 * admission turnstile before waiting for every outstanding read permit. A reader acquires its
 * permit while it still owns that turnstile, so it cannot slip behind a writer and run afterward
 * with state captured before the write.
 */
export function makeEffectReadWriteGate(): Effect.Effect<EffectReadWriteGate> {
  return Effect.gen(function* () {
    const admission = yield* Effect.makeSemaphore(1)
    const reads = yield* Effect.makeSemaphore(CONCURRENT_READ_PERMITS)

    const read: EffectReadWriteGate['read'] = (effect) =>
      Effect.acquireUseRelease(
        admission.withPermits(1)(reads.take(1)),
        () => effect,
        (permits) => reads.release(permits),
      )

    const write: EffectReadWriteGate['write'] = (effect) =>
      admission.withPermits(1)(reads.withPermits(CONCURRENT_READ_PERMITS)(effect))

    return { read, write }
  })
}

import * as Effect from 'effect/Effect'

/**
 * `Effect.runPromise(effect, { signal })` that leaves nothing on the signal once it settles.
 *
 * Effect registers its interrupting `abort` listener with `{ once: true }` and never removes it,
 * so every run leaks one listener, and the settled fiber it closes over, onto the caller's signal
 * until that signal aborts. On a long-lived signal (a Session `wait` re-resolves its caller on
 * every target event for up to 30 minutes) the listeners pile up into the tens of thousands, and
 * Node's `addEventListener` scans them all for a duplicate, so each run gets slower: 40,000 runs
 * on one signal took 36 s, most of it in that scan. Each run here gets its own short-lived signal,
 * linked to the caller's only while the run is in flight.
 */
export async function runEffectWithAbortSignal<A, E>(
  effect: Effect.Effect<A, E>,
  signal?: AbortSignal,
): Promise<A> {
  if (!signal) return Effect.runPromise(effect)
  if (signal.aborted) return Effect.runPromise(effect, { signal })
  const run = new AbortController()
  const forwardAbort = () => run.abort(signal.reason)
  signal.addEventListener('abort', forwardAbort, { once: true })
  try {
    return await Effect.runPromise(effect, { signal: run.signal })
  } finally {
    signal.removeEventListener('abort', forwardAbort)
  }
}

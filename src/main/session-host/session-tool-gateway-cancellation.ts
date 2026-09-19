import * as Effect from 'effect/Effect'

function sessionToolAbortReason(signal: AbortSignal) {
  return signal.reason instanceof Error ? signal.reason : new Error('aborted')
}

export function throwIfSessionToolAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw sessionToolAbortReason(signal)
}

export async function runSessionToolCallerResolution<A, E>(
  resolution: Effect.Effect<A, E>,
  signal?: AbortSignal,
) {
  throwIfSessionToolAborted(signal)
  const caller = await Effect.runPromise(resolution, signal ? { signal } : undefined)
  throwIfSessionToolAborted(signal)
  return caller
}

import type * as Effect from 'effect/Effect'
import { runEffectWithAbortSignal } from '../utils/run-effect-with-abort-signal'

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
  const caller = await runEffectWithAbortSignal(resolution, signal)
  throwIfSessionToolAborted(signal)
  return caller
}

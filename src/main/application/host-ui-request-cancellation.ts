import * as Effect from 'effect/Effect'

function abortSignalEffect(signal: AbortSignal): Effect.Effect<never, Error> {
  return Effect.async<never, Error>((resume) => {
    const abort = () => {
      const reason: unknown = signal.reason
      resume(
        Effect.fail(reason instanceof Error ? reason : new Error('Host UI request was cancelled.')),
      )
    }
    if (signal.aborted) {
      abort()
      return
    }
    signal.addEventListener('abort', abort, { once: true })
    return Effect.sync(() => signal.removeEventListener('abort', abort))
  })
}

export function raceHostUiRequestWithSignal<A, E, R>(
  operation: Effect.Effect<A, E, R>,
  signal?: AbortSignal,
) {
  return signal ? Effect.raceFirst(operation, abortSignalEffect(signal)) : operation
}

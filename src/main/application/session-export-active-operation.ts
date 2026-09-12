import * as Effect from 'effect/Effect'

const activeExportCancellations = new Map<string, Set<AbortController>>()

function cancellationEffect(signal: AbortSignal): Effect.Effect<never, Error> {
  return Effect.async<never, Error>((resume) => {
    const abort = () => resume(Effect.fail(new Error('EXPORT_CANCELLED')))
    if (signal.aborted) {
      abort()
      return
    }
    signal.addEventListener('abort', abort, { once: true })
    return Effect.sync(() => signal.removeEventListener('abort', abort))
  })
}

function registerActiveExport(operationId: string) {
  const controller = new AbortController()
  const controllers = activeExportCancellations.get(operationId) ?? new Set<AbortController>()
  controllers.add(controller)
  activeExportCancellations.set(operationId, controllers)
  return {
    signal: controller.signal,
    release: () => {
      controllers.delete(controller)
      if (controllers.size === 0) activeExportCancellations.delete(operationId)
    },
  }
}

export function cancelActiveSessionExport(operationId: string) {
  for (const controller of activeExportCancellations.get(operationId) ?? []) {
    controller.abort()
  }
}

export function runActiveSessionExport<A, E, R>(
  operationId: string,
  effect: Effect.Effect<A, E, R>,
) {
  return Effect.acquireUseRelease(
    Effect.sync(() => registerActiveExport(operationId)),
    (registration) => Effect.raceFirst(effect, cancellationEffect(registration.signal)),
    (registration) => Effect.sync(registration.release),
  )
}

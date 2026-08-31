import * as Effect from 'effect/Effect'
import { tryGetSessionHostEventRuntime } from '../session-host/session-host-events'

export class SessionHostDrainingError extends Error {
  readonly code = 'host_draining'
  readonly retryable = true

  constructor() {
    super('The Session Host is draining and is not accepting new Runs or exports.')
    this.name = 'SessionHostDrainingError'
  }
}

export interface SessionHostRunLease {
  readonly release: () => void
}

export function acquireSessionHostRunLease(kind: 'run' | 'export') {
  return Effect.try({
    try: () => {
      const runtime = tryGetSessionHostEventRuntime()
      if (!runtime) return { release: () => undefined } satisfies SessionHostRunLease
      const release = runtime.liveness.acquire(kind)
      return { release } satisfies SessionHostRunLease
    },
    catch: () => new SessionHostDrainingError(),
  })
}

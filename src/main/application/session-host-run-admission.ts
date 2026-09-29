import * as Effect from 'effect/Effect'
import { tryGetSessionHostEventRuntime } from '../session-host/session-host-events'

export class SessionHostDrainingError extends Error {
  readonly code = 'host_draining'
  readonly retryable = true

  constructor() {
    super(
      'The Session Host is stopping and is no longer accepting new work; try again once it has stopped.',
    )
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

/**
 * Waits can hold the Host open for many minutes, so a draining Host refuses them. The
 * refusal is the retryable `host_draining` error, like any other refused work.
 */
export function acquireWaitLiveness(liveness: { acquire: (kind: 'wait') => () => void }) {
  try {
    return liveness.acquire('wait')
  } catch {
    throw new SessionHostDrainingError()
  }
}

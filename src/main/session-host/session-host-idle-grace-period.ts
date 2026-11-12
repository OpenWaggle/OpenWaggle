import type { SessionHostLiveness } from '../application/session-host-liveness'
import { createLogger } from '../logger'

const logger = createLogger('session-host/runtime')

/**
 * Re-reads the idle grace period every `intervalMs` and applies it to the Host's liveness, so a
 * settings change takes effect without a restart. Returns the function that stops it.
 */
export function observeIdleGracePeriod(input: {
  readonly liveness: SessionHostLiveness
  readonly read: () => Promise<number>
  readonly intervalMs: number
}) {
  let closed = false
  let timer: ReturnType<typeof setTimeout> | undefined
  const schedule = () => {
    if (closed) return
    timer = setTimeout(() => {
      void input
        .read()
        .then((idleGracePeriodMs) => {
          if (!closed) input.liveness.updateIdleGracePeriod(idleGracePeriodMs)
        })
        .catch((error: unknown) => {
          logger.warn('Failed to refresh the Session Host idle grace period.', {
            error: error instanceof Error ? error.message : String(error),
          })
        })
        .finally(schedule)
    }, input.intervalMs)
  }
  schedule()
  return () => {
    closed = true
    if (timer) clearTimeout(timer)
  }
}

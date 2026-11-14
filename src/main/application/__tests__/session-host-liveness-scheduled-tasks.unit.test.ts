import { afterEach, describe, expect, it, vi } from 'vitest'
import { SessionHostLiveness } from '../session-host-liveness'

/** An enabled Scheduled task keeps the Host from idling out but never holds up a stop (ADR 0057). */
describe('Session Host liveness with enabled Scheduled tasks', () => {
  afterEach(() => vi.useRealTimers())

  it('keeps an idle Host running while a Scheduled task is enabled', async () => {
    vi.useFakeTimers()
    const requestShutdown = vi.fn()
    const liveness = new SessionHostLiveness({ idleGracePeriodMs: 1000, requestShutdown })
    liveness.acquire('client')()
    const releaseSchedule = liveness.acquire('scheduled-task')

    await vi.advanceTimersByTimeAsync(60_000)
    expect(requestShutdown).not.toHaveBeenCalled()

    releaseSchedule()
    await vi.advanceTimersByTimeAsync(0)
    // The idle time kept counting from the last real work, so the grace has already passed.
    expect(requestShutdown).toHaveBeenCalledOnce()
  })

  it.each([false, true])(
    'lets a stop drain the Host although a Scheduled task is enabled (Run in flight: %s)',
    (runInFlight) => {
      const requestShutdown = vi.fn()
      const liveness = new SessionHostLiveness({ idleGracePeriodMs: 1000, requestShutdown })
      liveness.acquire('scheduled-task')
      // A Run the Scheduled task started before the drain still holds it.
      const releaseRun = runInFlight ? liveness.acquire('run') : undefined

      liveness.requestDrain('stop')
      if (releaseRun !== undefined) {
        expect(requestShutdown).not.toHaveBeenCalled()
        releaseRun()
      }

      expect(requestShutdown).toHaveBeenCalledOnce()
    },
  )
})

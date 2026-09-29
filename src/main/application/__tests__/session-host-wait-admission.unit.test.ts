import { describe, expect, it, vi } from 'vitest'
import { SessionHostLiveness } from '../session-host-liveness'
import { acquireWaitLiveness } from '../session-host-run-admission'

describe('waits on a draining Session Host', () => {
  it('are refused with the retryable host_draining error', () => {
    const liveness = new SessionHostLiveness({
      idleGracePeriodMs: 60_000,
      requestShutdown: vi.fn(),
    })
    const releaseRun = liveness.acquire('run')
    liveness.requestDrain('stop')

    expect(() => acquireWaitLiveness(liveness)).toThrow(
      expect.objectContaining({ code: 'host_draining', retryable: true }),
    )
    releaseRun()
  })
})

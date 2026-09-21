import { SessionId } from '@shared/types/brand'
import * as Effect from 'effect/Effect'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { installSessionHostEventRuntime } from '../../session-host/session-host-events'
import { cancelAllSessionRuns, reserveActiveSessionRun } from '../active-session-runs'
import { fenceFailedClaimedSessionOperation } from '../session-control-claimed-operation-recovery'
import { SessionHostEventHub } from '../session-host-event-hub'
import { SessionHostLiveness } from '../session-host-liveness'

describe('failed claimed Session operation recovery', () => {
  afterEach(() => cancelAllSessionRuns())

  it('interrupts the affected writer and drains the Host for durable recovery', () => {
    const sessionId = SessionId('session-claimed-operation-failed')
    const writer = reserveActiveSessionRun(sessionId, 'run-active')
    const requestShutdown = vi.fn()
    const liveness = new SessionHostLiveness({ idleGracePeriodMs: 60_000, requestShutdown })
    const releaseRunOwner = liveness.acquire('run')
    const releaseRuntime = installSessionHostEventRuntime({
      eventHub: new SessionHostEventHub(),
      liveness,
    })

    try {
      Effect.runSync(fenceFailedClaimedSessionOperation(sessionId))

      expect(writer.controller.signal.aborted).toBe(true)
      expect(liveness.isDraining()).toBe(true)
      expect(requestShutdown).not.toHaveBeenCalled()

      writer.release()
      expect(requestShutdown).not.toHaveBeenCalled()
      releaseRunOwner()
      expect(requestShutdown).toHaveBeenCalledOnce()
    } finally {
      writer.release()
      releaseRunOwner()
      releaseRuntime()
      liveness.close()
    }
  })
})

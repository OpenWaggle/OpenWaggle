import { randomUUID } from 'node:crypto'
import { fromPartial } from '@total-typescript/shoehorn'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { idleCacheWarming } from '../../adapters/pi/agent-kernel/pi-idle-cache-warming'
import { SessionHostEventHub } from '../../application/session-host-event-hub'
import { SessionHostLiveness } from '../../application/session-host-liveness'
import { installSessionHostEventRuntime, publishSessionHostEvent } from '../session-host-events'

type PiSession = Parameters<typeof idleCacheWarming.settle>[1]

function warmingPiSession() {
  return fromPartial<PiSession>({
    cacheWarmingStatus: { state: 'scheduled', nextWarmAt: Date.now() + 60_000 },
    extensionRunner: { emit: vi.fn(async () => undefined) },
    dispose: vi.fn(),
    sessionManager: { appendUsage: vi.fn() },
  })
}

describe('prompt cache warming of an unarchived Session', () => {
  let releaseRuntime: (() => void) | undefined
  let liveness: SessionHostLiveness | undefined
  let sessionId = ''

  beforeEach(() => {
    sessionId = `cache-warming-${randomUUID()}`
    liveness = new SessionHostLiveness({
      idleGracePeriodMs: 60_000,
      requestShutdown: () => undefined,
    })
    releaseRuntime = installSessionHostEventRuntime({
      eventHub: new SessionHostEventHub(),
      liveness,
    })
  })

  afterEach(async () => {
    releaseRuntime?.()
    liveness?.close()
    await idleCacheWarming.releaseAll()
  })

  it('lets a Session warm again once it is unarchived', async () => {
    idleCacheWarming.close(sessionId)
    await expect(
      idleCacheWarming.settle(sessionId, warmingPiSession(), { aborted: false }),
    ).resolves.toBe('disposed')

    publishSessionHostEvent({ kind: 'session-list-changed', sessionId, change: 'unarchived' })

    await expect(
      idleCacheWarming.settle(sessionId, warmingPiSession(), { aborted: false }),
    ).resolves.toBe('warming')
  })
})

import { SessionId } from '@shared/types/brand'
import { fromPartial } from '@total-typescript/shoehorn'
import * as Effect from 'effect/Effect'
import { describe, expect, it, vi } from 'vitest'
import { idleCacheWarming } from '../adapters/pi/agent-kernel/pi-idle-cache-warming'
import { promptCacheWarming } from '../application/prompt-cache-warming'
import { runSessionRemovalHooks } from '../application/session-removal-hooks'
import { installSettingsStoreTestLifecycle } from '../store/__tests__/settings-test-harness'

type PiSession = Parameters<typeof idleCacheWarming.settle>[1]

function warmingPiSession() {
  return fromPartial<PiSession>({
    cacheWarmingStatus: { state: 'scheduled', nextWarmAt: Date.now() + 60_000 },
    extensionRunner: { emit: vi.fn(async () => undefined) },
    dispose: vi.fn(),
    sessionManager: { appendUsage: vi.fn() },
  })
}

/** The Host ends a Session's warming session before anything removes or outlives its Pi file. */
describe('the Host and warming sessions', () => {
  installSettingsStoreTestLifecycle()

  it('wires warming into the Host when the runtime initializes, not when it is imported', async () => {
    await import('../runtime')
    const session = warmingPiSession()
    await idleCacheWarming.settle('imported-only', session, { aborted: false })

    promptCacheWarming().closeSession('imported-only')
    expect(idleCacheWarming.borrow('imported-only')).toBe(session)

    const { initializeAppRuntime } = await import('../runtime')
    await initializeAppRuntime()
    promptCacheWarming().closeSession('imported-only')
    expect(idleCacheWarming.borrow('imported-only')).toBeUndefined()
  })

  it('ends the warming session before an archived or deleted Session is removed', async () => {
    const { initializeAppRuntime } = await import('../runtime')
    await initializeAppRuntime()
    const sessionId = SessionId('removed-while-warming')
    const session = warmingPiSession()
    await idleCacheWarming.settle(sessionId, session, { aborted: false })

    await Effect.runPromise(runSessionRemovalHooks(sessionId))

    expect(idleCacheWarming.borrow(sessionId)).toBeUndefined()
    expect(session.dispose).toHaveBeenCalledOnce()
    await expect(
      idleCacheWarming.settle(sessionId, warmingPiSession(), { aborted: false }),
    ).resolves.toBe('disposed')
  })

  it('ends every warming session when the Host stops', async () => {
    const { stopSessionHostOwnedServices } = await import('../runtime')
    const session = warmingPiSession()
    await idleCacheWarming.settle('warming-at-stop', session, { aborted: false })

    await stopSessionHostOwnedServices()

    expect(idleCacheWarming.borrow('warming-at-stop')).toBeUndefined()
    expect(session.dispose).toHaveBeenCalledOnce()
  })
})

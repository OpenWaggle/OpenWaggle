import type { AgentSession } from '@earendil-works/pi-coding-agent'
import { DEFAULT_SETTINGS } from '@shared/types/settings'
import { fromPartial } from '@total-typescript/shoehorn'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { publishSettingsStoreState } from '../../../../store/authoritative-settings'
import { idleCacheWarming } from '../pi-idle-cache-warming'

function warmingPiSession() {
  return fromPartial<AgentSession>({
    cacheWarmingStatus: { state: 'scheduled', nextWarmAt: Date.now() + 60_000 },
    extensionRunner: { emit: vi.fn(async () => undefined) },
    dispose: vi.fn(),
  })
}

beforeEach(() => {
  publishSettingsStoreState(true, { ...DEFAULT_SETTINGS, cacheWarming: 'idle' }, false)
})

afterEach(async () => {
  await idleCacheWarming.releaseAll()
})

describe('turning prompt cache warming between runs off', () => {
  it.each(['off', 'streaming'] as const)(
    'ends the warming sessions already running when the setting becomes %s',
    async (mode) => {
      publishSettingsStoreState(true, { ...DEFAULT_SETTINGS, cacheWarming: 'idle' }, false)
      const session = warmingPiSession()
      await idleCacheWarming.settle('session-a', session, { aborted: false })

      publishSettingsStoreState(true, { ...DEFAULT_SETTINGS, cacheWarming: mode }, false)

      expect(idleCacheWarming.borrow('session-a')).toBeUndefined()
      expect(session.dispose).toHaveBeenCalledOnce()
    },
  )

  it('keeps them while the setting stays between runs', async () => {
    publishSettingsStoreState(true, { ...DEFAULT_SETTINGS, cacheWarming: 'idle' }, false)
    const session = warmingPiSession()
    await idleCacheWarming.settle('session-a', session, { aborted: false })

    publishSettingsStoreState(true, { ...DEFAULT_SETTINGS, cacheWarming: 'idle' }, false)

    expect(idleCacheWarming.borrow('session-a')).toBe(session)
  })

  it('does not start warming for a Run that ends after the setting left between runs', async () => {
    publishSettingsStoreState(true, { ...DEFAULT_SETTINGS, cacheWarming: 'off' }, false)

    await expect(
      idleCacheWarming.settle('session-a', warmingPiSession(), { aborted: false }),
    ).resolves.toBe('disposed')
  })
})

describe('a Session closed while its Run is ending', () => {
  it('is not kept warming when it is archived during the Run session shutdown', async () => {
    const session = fromPartial<AgentSession>({
      cacheWarmingStatus: { state: 'scheduled', nextWarmAt: Date.now() + 60_000 },
      extensionRunner: {
        emit: vi.fn(async () => {
          idleCacheWarming.close('session-closing')
        }),
      },
      dispose: vi.fn(),
    })

    await expect(
      idleCacheWarming.settle('session-closing', session, { aborted: false }),
    ).resolves.toBe('disposed')

    expect(idleCacheWarming.borrow('session-closing')).toBeUndefined()
    expect(session.dispose).toHaveBeenCalledOnce()
  })
})

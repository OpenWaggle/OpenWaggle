import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { AgentSession } from '@earendil-works/pi-coding-agent'
import { DEFAULT_SETTINGS } from '@shared/types/settings'
import { fromPartial } from '@total-typescript/shoehorn'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { installPiRuntimeIntegration } from '../../../../runtime-pi-integration'
import { publishSettingsStoreState } from '../../../../store/authoritative-settings'
import { createIdleCacheWarming, idleCacheWarming } from '../pi-idle-cache-warming'

function warmingPiSession() {
  return fromPartial<AgentSession>({
    cacheWarmingStatus: { state: 'scheduled', nextWarmAt: Date.now() + 60_000 },
    extensionRunner: { emit: vi.fn(async () => undefined) },
    dispose: vi.fn(),
    sessionManager: { appendUsage: vi.fn() },
  })
}

let uninstallPiRuntimeIntegration: () => void = () => undefined

beforeEach(() => {
  // The Host's composition root passes the authoritative settings to the warming sessions.
  uninstallPiRuntimeIntegration = installPiRuntimeIntegration()
  publishSettingsStoreState(true, { ...DEFAULT_SETTINGS, cacheWarming: 'idle' }, false)
})

afterEach(async () => {
  uninstallPiRuntimeIntegration()
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

  it('acts on settings only through the Host, not on its own when imported', async () => {
    uninstallPiRuntimeIntegration()
    const session = warmingPiSession()
    await idleCacheWarming.settle('session-a', session, { aborted: false })

    publishSettingsStoreState(true, { ...DEFAULT_SETTINGS, cacheWarming: 'off' }, false)

    expect(idleCacheWarming.borrow('session-a')).toBe(session)
  })

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
          idleCacheWarming.closeSession('session-closing')
        }),
      },
      dispose: vi.fn(),
      sessionManager: { appendUsage: vi.fn() },
    })

    await expect(
      idleCacheWarming.settle('session-closing', session, { aborted: false }),
    ).resolves.toBe('disposed')

    expect(idleCacheWarming.borrow('session-closing')).toBeUndefined()
    expect(session.dispose).toHaveBeenCalledOnce()
  })
})

function fakeWarmingSession(
  sessionFile?: string,
  onShutdown: () => Promise<void> = async () => {},
) {
  return fromPartial<AgentSession>({
    ...(sessionFile ? { sessionFile } : {}),
    cacheWarmingStatus: { state: 'scheduled', nextWarmAt: Date.now() + 60_000 },
    extensionRunner: { emit: vi.fn(onShutdown) },
    dispose: vi.fn(),
    sessionManager: { appendUsage: vi.fn() },
  })
}

describe('warming sessions and the Host lifecycle', () => {
  it('keeps no session a settle was still shutting down when the Host stopped', async () => {
    const warming = createIdleCacheWarming()
    const session = fakeWarmingSession(undefined, async () => {
      await warming.stop()
    })

    await expect(warming.settle('session-a', session, { aborted: false })).resolves.toBe('disposed')
    await expect(
      warming.settle('session-b', fakeWarmingSession(), { aborted: false }),
    ).resolves.toBe('disposed')

    warming.start()
    await expect(
      warming.settle('session-b', fakeWarmingSession(), { aborted: false }),
    ).resolves.toBe('warming')
    await warming.stop()
  })

  it("does not end a Session's newer warming session from an older one's write guard", async () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'openwaggle-warming-guard-'))
    const file = path.join(directory, 'session.jsonl')
    writeFileSync(file, '{"type":"session"}\n')
    const warming = createIdleCacheWarming()
    const older = fakeWarmingSession(file)
    const olderAppendUsage = () =>
      older.sessionManager.appendUsage('cache_warm', 'p', 'm', fromPartial({}))
    await warming.settle('session-a', older, { aborted: false })
    // The next Run wrote the file, then left a newer warming session.
    appendFileSync(file, '{"type":"message"}\n')
    const newer = fakeWarmingSession(file)
    await warming.settle('session-a', newer, { aborted: false })

    expect(olderAppendUsage).toThrow()

    expect(warming.borrow('session-a')).toBe(newer)
    await warming.stop()
    rmSync(directory, { recursive: true, force: true })
  })

  it('forgets a deleted Session instead of keeping it closed forever', async () => {
    const warming = createIdleCacheWarming()
    warming.closeSession('session-a')
    warming.forgetSession('session-a')

    await expect(
      warming.settle('session-a', fakeWarmingSession(), { aborted: false }),
    ).resolves.toBe('warming')
    await warming.stop()
  })
})

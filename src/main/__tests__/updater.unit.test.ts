import type { BuildChannel } from '@shared/types/build-identity'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockIsDev,
  mockBuildChannel,
  mockBroadcastToWindows,
  mockConfigureUpdaterFeed,
  mockCancelDownload,
} = vi.hoisted(() => {
  const mockBuildChannel: { value: BuildChannel } = { value: 'alpha' }

  return {
    mockIsDev: { value: false },
    mockBuildChannel,
    mockBroadcastToWindows: vi.fn(),
    mockConfigureUpdaterFeed: vi.fn(),
    mockCancelDownload: vi.fn(),
  }
})
const engine = await vi.hoisted(async () =>
  (await import('../test-support/fake-update-engine')).fakeUpdateEngine(),
)

vi.mock('../desktop-shell/app-lifecycle', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../desktop-shell/app-lifecycle')>()
  return { appLifecycle: { ...actual.appLifecycle, isPackaged: () => !mockIsDev.value } }
})

vi.mock('@shared/build-identity-runtime', () => ({
  get BUILD_CHANNEL() {
    return mockBuildChannel.value
  },
}))

vi.mock('../desktop-shell/update-engine', () => ({ updateEngine: engine }))

vi.mock('../utils/broadcast', () => ({
  broadcastToWindows: (...args: unknown[]) => mockBroadcastToWindows(...args),
}))

vi.mock('../update-feed', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../update-feed')>()),
  configureUpdaterFeed: (...args: unknown[]) => mockConfigureUpdaterFeed(...args),
}))

vi.mock('../logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}))

import {
  checkForUpdates,
  disposeAutoUpdater,
  getUpdateStatus,
  initAutoUpdater,
  installUpdate,
} from '../updater'

describe('updater service', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    mockIsDev.value = false
    mockBuildChannel.value = 'alpha'
    mockBroadcastToWindows.mockReset()
    mockConfigureUpdaterFeed.mockReset()
    // The feed lists a release, so each check goes on to ask the updater.
    mockConfigureUpdaterFeed.mockResolvedValue({ type: 'release', tag: 'v0.5.0-alpha.1' })
    mockCancelDownload.mockReset()
    engine.reset()
    disposeAutoUpdater()
  })

  afterEach(() => {
    vi.useRealTimers()
    disposeAutoUpdater()
    engine.reset()
  })

  describe('getUpdateStatus', () => {
    it('returns idle status initially', () => {
      const status = getUpdateStatus()
      expect(status).toEqual({ type: 'idle' })
    })
  })

  describe('checkForUpdates', () => {
    it('is a no-op in dev mode', () => {
      mockIsDev.value = true
      checkForUpdates()
      expect(engine.checkForUpdates).not.toHaveBeenCalled()
    })

    it('asks the update engine to check in prod mode', async () => {
      mockIsDev.value = false
      checkForUpdates()
      await vi.waitFor(() => expect(engine.checkForUpdates).toHaveBeenCalledOnce())
    })

    it('is a no-op for dev channel builds even outside dev mode', () => {
      mockIsDev.value = false
      mockBuildChannel.value = 'dev'
      checkForUpdates()
      expect(engine.checkForUpdates).not.toHaveBeenCalled()
    })
  })

  describe('installUpdate', () => {
    it('installs silently and forces the app to relaunch', async () => {
      initAutoUpdater('stable')
      engine.report.downloaded('1.2.3')
      await installUpdate()
      expect(engine.quitAndInstall).toHaveBeenCalledWith({ silent: true, relaunch: true })
    })
  })

  describe('initAutoUpdater', () => {
    it('is a no-op in dev mode', () => {
      mockIsDev.value = true
      initAutoUpdater('alpha')
      vi.advanceTimersByTime(10_000)
      expect(engine.checkForUpdates).not.toHaveBeenCalled()
      expect(engine.listenerCounts().checking).toBe(0)
    })

    it('registers event listeners in prod mode', () => {
      mockIsDev.value = false
      initAutoUpdater('alpha')
      for (const count of Object.values(engine.listenerCounts())) expect(count).toBeGreaterThan(0)
    })

    it('triggers an initial checkForUpdates after the startup delay', async () => {
      mockIsDev.value = false
      initAutoUpdater('alpha')
      expect(engine.checkForUpdates).not.toHaveBeenCalled()
      await vi.advanceTimersByTimeAsync(5_001)
      expect(engine.checkForUpdates).toHaveBeenCalledOnce()
    })

    it('refreshes the authoritative channel before periodic checks', async () => {
      let savedChannel: 'alpha' | 'stable' = 'alpha'
      const readChannel = vi.fn(() => Promise.resolve(savedChannel))
      initAutoUpdater('alpha', readChannel)

      await vi.advanceTimersByTimeAsync(5_001)
      expect(mockConfigureUpdaterFeed).toHaveBeenLastCalledWith(expect.anything(), 'alpha')

      savedChannel = 'stable'
      await vi.advanceTimersByTimeAsync(4 * 60 * 60 * 1_000)
      expect(mockConfigureUpdaterFeed).toHaveBeenLastCalledWith(expect.anything(), 'stable')
      expect(readChannel).toHaveBeenCalledTimes(2)
    })

    it('cancels and invalidates an Alpha download when switching to Stable', async () => {
      engine.checkForUpdates.mockResolvedValueOnce({
        version: '0.5.0-alpha.1',
        cancelDownload: mockCancelDownload,
        download: Promise.resolve([]),
      })
      initAutoUpdater('alpha')

      checkForUpdates('alpha')
      await vi.advanceTimersByTimeAsync(0)

      checkForUpdates('stable')

      expect(mockCancelDownload).toHaveBeenCalledOnce()
      expect(engine.settings.installOnQuit).toBe(false)
    })

    it('invalidates an already downloaded Alpha update when switching to Stable', async () => {
      initAutoUpdater('alpha')
      engine.report.downloaded('0.5.0-alpha.1')
      expect(engine.settings.installOnQuit).toBe(false)

      checkForUpdates('stable')

      expect(engine.settings.installOnQuit).toBe(false)
      expect(getUpdateStatus()).not.toEqual({ type: 'downloaded', version: '0.5.0-alpha.1' })
      await installUpdate()
      expect(engine.quitAndInstall).not.toHaveBeenCalled()
      mockBroadcastToWindows.mockClear()

      engine.report.available('0.5.0-alpha.1')
      engine.report.downloaded('0.5.0-alpha.1')

      expect(engine.settings.installOnQuit).toBe(false)
      const statusTypes = mockBroadcastToWindows.mock.calls.map(([, status]) => status.type)
      expect(statusTypes).not.toContain('available')
      expect(statusTypes).not.toContain('downloaded')
    })

    it('does not register listeners for dev channel builds', () => {
      mockIsDev.value = false
      mockBuildChannel.value = 'dev'
      initAutoUpdater('alpha')
      vi.advanceTimersByTime(10_000)
      expect(engine.checkForUpdates).not.toHaveBeenCalled()
      expect(engine.listenerCounts().checking).toBe(0)
    })

    it('uses the Alpha feed and allows prereleases', () => {
      mockIsDev.value = false
      mockBuildChannel.value = 'alpha'
      initAutoUpdater('alpha')
      // The engine never downgrades (UpdateEngine.configure), whatever the channel allows.
      expect(engine.settings).toMatchObject({ feedChannel: 'alpha', allowPrerelease: true })
    })

    it('maps the Stable preference to the latest feed channel', () => {
      initAutoUpdater('stable')
      expect(engine.settings).toMatchObject({ feedChannel: 'latest', allowPrerelease: false })
    })
  })

  describe('status broadcasting from update engine events', () => {
    beforeEach(() => {
      mockIsDev.value = false
      initAutoUpdater('alpha')
    })

    it('broadcasts checking status when the engine starts checking', () => {
      engine.report.checking()
      expect(mockBroadcastToWindows).toHaveBeenCalledWith('updater:status-changed', {
        type: 'checking',
      })
    })

    it('broadcasts available status with version when the engine finds an update', () => {
      engine.report.available('1.2.3')
      expect(mockBroadcastToWindows).toHaveBeenCalledWith('updater:status-changed', {
        type: 'available',
        version: '1.2.3',
      })
    })

    it('broadcasts not-available status when the engine finds none', () => {
      engine.report.notAvailable()
      expect(mockBroadcastToWindows).toHaveBeenCalledWith('updater:status-changed', {
        type: 'not-available',
      })
    })

    it('broadcasts downloading status with percent rounded to integer as the download progresses', () => {
      // Emit available first so the version is tracked by the service
      engine.report.available('2.0.0')
      mockBroadcastToWindows.mockClear()

      engine.report.progress(42.7)
      expect(mockBroadcastToWindows).toHaveBeenCalledWith('updater:status-changed', {
        type: 'downloading',
        version: '2.0.0',
        percent: 43,
      })
    })

    it('ignores download progress before a channel-eligible available event', () => {
      engine.report.progress(10.0)
      expect(mockBroadcastToWindows).not.toHaveBeenCalled()
    })

    it('broadcasts downloaded status with version once the engine has downloaded it', () => {
      engine.report.downloaded('3.0.0')
      expect(mockBroadcastToWindows).toHaveBeenCalledWith('updater:status-changed', {
        type: 'downloaded',
        version: '3.0.0',
      })
    })

    it('broadcasts error status when the engine fails', () => {
      engine.report.error(new Error('network failure'))
      expect(mockBroadcastToWindows).toHaveBeenCalledWith('updater:status-changed', {
        type: 'error',
        message: 'network failure',
      })
    })
  })

  describe('disposeAutoUpdater', () => {
    it('clears the periodic interval so no further checks fire after disposal', async () => {
      mockIsDev.value = false
      initAutoUpdater('alpha')

      await vi.advanceTimersByTimeAsync(5_001)
      expect(engine.checkForUpdates).toHaveBeenCalledOnce()
      engine.checkForUpdates.mockClear()

      disposeAutoUpdater()

      vi.advanceTimersByTime(4 * 60 * 60 * 1_000 + 1)
      expect(engine.checkForUpdates).not.toHaveBeenCalled()
    })

    it('is safe to call when no interval is active', () => {
      expect(() => disposeAutoUpdater()).not.toThrow()
    })
  })
})

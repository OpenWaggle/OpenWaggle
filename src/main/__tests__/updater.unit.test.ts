import type { BuildChannel } from '@shared/types/build-identity'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// vi.hoisted() callbacks are hoisted above all imports, so they cannot reference
// imported symbols. Use a plain object container to share the emitter from the
// vi.mock factory (which also runs before module-scope code but after Node is ready).
const {
  mockIsDev,
  mockBuildChannel,
  mockBroadcastToWindows,
  mockCheckForUpdatesFn,
  mockConfigureUpdaterFeed,
  mockQuitAndInstall,
  autoUpdaterRef,
} = vi.hoisted(() => {
  const autoUpdaterRef: {
    current: import('node:events').EventEmitter | null
  } = { current: null }
  const mockBuildChannel: { value: BuildChannel } = { value: 'alpha' }

  return {
    mockIsDev: { value: false },
    mockBuildChannel,
    mockBroadcastToWindows: vi.fn(),
    mockCheckForUpdatesFn: vi.fn(() => Promise.resolve()),
    mockConfigureUpdaterFeed: vi.fn(),
    mockQuitAndInstall: vi.fn(),
    autoUpdaterRef,
  }
})

vi.mock('@electron-toolkit/utils', () => ({
  get is() {
    return { dev: mockIsDev.value }
  },
}))

vi.mock('@shared/build-identity-runtime', () => ({
  get BUILD_CHANNEL() {
    return mockBuildChannel.value
  },
}))

vi.mock('electron-updater', async () => {
  // EventEmitter is available here — vi.mock factories execute in Node context
  // after vi.hoisted() but before module-scope code outside mocks.
  const { EventEmitter } = await import('node:events')
  const emitter = new EventEmitter()

  // Expose to outer scope so tests can emit events and inspect listeners.
  autoUpdaterRef.current = emitter

  const autoUpdater = Object.assign(emitter, {
    allowDowngrade: false,
    allowPrerelease: false,
    autoDownload: true,
    autoInstallOnAppQuit: true,
    logger: null,
    checkForUpdates: () => mockCheckForUpdatesFn(),
    quitAndInstall: (isSilent: boolean, isForceRunAfter: boolean) =>
      mockQuitAndInstall(isSilent, isForceRunAfter),
  })

  return { autoUpdater }
})

vi.mock('../utils/broadcast', () => ({
  broadcastToWindows: (...args: unknown[]) => mockBroadcastToWindows(...args),
}))

vi.mock('../update-feed', () => ({
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

// Convenience getter so tests read more cleanly.
function emitter() {
  if (!autoUpdaterRef.current) throw new Error('autoUpdater emitter not initialized')
  return autoUpdaterRef.current
}

describe('updater service', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    mockIsDev.value = false
    mockBuildChannel.value = 'alpha'
    mockBroadcastToWindows.mockReset()
    mockCheckForUpdatesFn.mockReset()
    mockConfigureUpdaterFeed.mockReset()
    mockQuitAndInstall.mockReset()
    mockCheckForUpdatesFn.mockResolvedValue(undefined)
    emitter().removeAllListeners()
    disposeAutoUpdater()
  })

  afterEach(() => {
    vi.useRealTimers()
    disposeAutoUpdater()
    emitter().removeAllListeners()
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
      expect(mockCheckForUpdatesFn).not.toHaveBeenCalled()
    })

    it('calls autoUpdater.checkForUpdates in prod mode', () => {
      mockIsDev.value = false
      checkForUpdates()
      expect(mockCheckForUpdatesFn).toHaveBeenCalledOnce()
    })

    it('is a no-op for dev channel builds even outside dev mode', () => {
      mockIsDev.value = false
      mockBuildChannel.value = 'dev'
      checkForUpdates()
      expect(mockCheckForUpdatesFn).not.toHaveBeenCalled()
    })
  })

  describe('installUpdate', () => {
    it('calls quitAndInstall with correct arguments', () => {
      installUpdate()
      expect(mockQuitAndInstall).toHaveBeenCalledWith(false, true)
    })
  })

  describe('initAutoUpdater', () => {
    it('is a no-op in dev mode', () => {
      mockIsDev.value = true
      initAutoUpdater('alpha')
      vi.advanceTimersByTime(10_000)
      expect(mockCheckForUpdatesFn).not.toHaveBeenCalled()
      expect(emitter().listenerCount('checking-for-update')).toBe(0)
    })

    it('registers event listeners in prod mode', () => {
      mockIsDev.value = false
      initAutoUpdater('alpha')
      expect(emitter().listenerCount('checking-for-update')).toBeGreaterThan(0)
      expect(emitter().listenerCount('update-available')).toBeGreaterThan(0)
      expect(emitter().listenerCount('update-not-available')).toBeGreaterThan(0)
      expect(emitter().listenerCount('download-progress')).toBeGreaterThan(0)
      expect(emitter().listenerCount('update-downloaded')).toBeGreaterThan(0)
      expect(emitter().listenerCount('error')).toBeGreaterThan(0)
    })

    it('triggers an initial checkForUpdates after the startup delay', () => {
      mockIsDev.value = false
      initAutoUpdater('alpha')
      expect(mockCheckForUpdatesFn).not.toHaveBeenCalled()
      vi.advanceTimersByTime(5_001)
      expect(mockCheckForUpdatesFn).toHaveBeenCalledOnce()
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

    it('does not register listeners for dev channel builds', () => {
      mockIsDev.value = false
      mockBuildChannel.value = 'dev'
      initAutoUpdater('alpha')
      vi.advanceTimersByTime(10_000)
      expect(mockCheckForUpdatesFn).not.toHaveBeenCalled()
      expect(emitter().listenerCount('checking-for-update')).toBe(0)
    })

    it('uses the Alpha feed, allows prereleases, and still prevents downgrades', () => {
      mockIsDev.value = false
      mockBuildChannel.value = 'alpha'
      initAutoUpdater('alpha')
      expect(Reflect.get(emitter(), 'channel')).toBe('alpha')
      expect(Reflect.get(emitter(), 'allowPrerelease')).toBe(true)
      expect(Reflect.get(emitter(), 'allowDowngrade')).toBe(false)
    })

    it('maps the Stable preference to the electron-updater latest feed', () => {
      initAutoUpdater('stable')
      expect(Reflect.get(emitter(), 'channel')).toBe('latest')
      expect(Reflect.get(emitter(), 'allowPrerelease')).toBe(false)
      expect(Reflect.get(emitter(), 'allowDowngrade')).toBe(false)
    })
  })

  describe('status broadcasting via autoUpdater events', () => {
    beforeEach(() => {
      mockIsDev.value = false
      initAutoUpdater('alpha')
    })

    it('broadcasts checking status on checking-for-update event', () => {
      emitter().emit('checking-for-update')
      expect(mockBroadcastToWindows).toHaveBeenCalledWith('updater:status-changed', {
        type: 'checking',
      })
    })

    it('broadcasts available status with version on update-available event', () => {
      emitter().emit('update-available', { version: '1.2.3' })
      expect(mockBroadcastToWindows).toHaveBeenCalledWith('updater:status-changed', {
        type: 'available',
        version: '1.2.3',
      })
    })

    it('broadcasts not-available status on update-not-available event', () => {
      emitter().emit('update-not-available')
      expect(mockBroadcastToWindows).toHaveBeenCalledWith('updater:status-changed', {
        type: 'not-available',
      })
    })

    it('broadcasts downloading status with percent rounded to integer on download-progress event', () => {
      // Emit available first so the version is tracked by the service
      emitter().emit('update-available', { version: '2.0.0' })
      mockBroadcastToWindows.mockClear()

      emitter().emit('download-progress', { percent: 42.7 })
      expect(mockBroadcastToWindows).toHaveBeenCalledWith('updater:status-changed', {
        type: 'downloading',
        version: '2.0.0',
        percent: 43,
      })
    })

    it('uses "unknown" version when download starts before an available event', () => {
      emitter().emit('download-progress', { percent: 10.0 })
      expect(mockBroadcastToWindows).toHaveBeenCalledWith('updater:status-changed', {
        type: 'downloading',
        version: 'unknown',
        percent: 10,
      })
    })

    it('broadcasts downloaded status with version on update-downloaded event', () => {
      emitter().emit('update-downloaded', { version: '3.0.0' })
      expect(mockBroadcastToWindows).toHaveBeenCalledWith('updater:status-changed', {
        type: 'downloaded',
        version: '3.0.0',
      })
    })

    it('broadcasts error status on error event', () => {
      emitter().emit('error', new Error('network failure'))
      expect(mockBroadcastToWindows).toHaveBeenCalledWith('updater:status-changed', {
        type: 'error',
        message: 'network failure',
      })
    })
  })

  describe('disposeAutoUpdater', () => {
    it('clears the periodic interval so no further checks fire after disposal', () => {
      mockIsDev.value = false
      initAutoUpdater('alpha')

      vi.advanceTimersByTime(5_001)
      expect(mockCheckForUpdatesFn).toHaveBeenCalledOnce()
      mockCheckForUpdatesFn.mockClear()

      disposeAutoUpdater()

      vi.advanceTimersByTime(4 * 60 * 60 * 1_000 + 1)
      expect(mockCheckForUpdatesFn).not.toHaveBeenCalled()
    })

    it('is safe to call when no interval is active', () => {
      expect(() => disposeAutoUpdater()).not.toThrow()
    })
  })
})

import type { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const nativeAutoUpdater: { current: EventEmitter | null } = { current: null }
  return {
    nativeAutoUpdater,
    releaseHost: { value: false },
    markUpdateQuit: vi.fn(),
    initAutoUpdater: vi.fn(),
    disposeAutoUpdater: vi.fn(),
  }
})

vi.mock('electron', async () => {
  const { EventEmitter: Emitter } = await import('node:events')
  const nativeAutoUpdater = new Emitter()
  mocks.nativeAutoUpdater.current = nativeAutoUpdater
  return {
    app: { getPath: () => '/tmp/user-data', getVersion: () => '1.2.2' },
    autoUpdater: nativeAutoUpdater,
  }
})
vi.mock('../updater', () => ({
  initAutoUpdater: (...args: unknown[]) => mocks.initAutoUpdater(...args),
  disposeAutoUpdater: () => mocks.disposeAutoUpdater(),
}))
vi.mock('../update-install-tracker', () => ({
  markUpdateQuit: () => {
    mocks.markUpdateQuit()
    mocks.releaseHost.value = true
  },
  shouldReleaseHostOnQuit: () => mocks.releaseHost.value,
}))
vi.mock('../store/settings', () => ({
  getSettings: () => ({ updateChannel: 'beta' }),
  hydrateSettingsStoreFromHost: vi.fn(),
}))
vi.mock('../application/gui-session-command-router', () => ({
  invokeConfiguredHostUi: vi.fn(),
}))
vi.mock('../logger', () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}))

import {
  disposeGuiAutoUpdater,
  isGuiInstallingUpdate,
  startGuiAutoUpdater,
} from '../gui-auto-updater'

describe('desktop app updater start-up', () => {
  it('releases the Host on any quit the installer announces, even one the app did not start', async () => {
    await startGuiAutoUpdater()
    expect(mocks.initAutoUpdater).toHaveBeenCalledWith('beta', expect.any(Function), {
      userDataDirectory: '/tmp/user-data',
      currentVersion: '1.2.2',
      bundleIdentifier: 'com.openwaggle.app',
    })
    expect(isGuiInstallingUpdate()).toBe(false)

    // Squirrel.Mac (natively) and electron-updater (for NSIS and AppImage) emit this before quitting.
    mocks.nativeAutoUpdater.current?.emit('before-quit-for-update')

    expect(mocks.markUpdateQuit).toHaveBeenCalledOnce()
    expect(isGuiInstallingUpdate()).toBe(true)
    disposeGuiAutoUpdater()
    expect(mocks.disposeAutoUpdater).toHaveBeenCalledOnce()
  })
})

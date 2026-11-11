import { describe, expect, it, vi } from 'vitest'

const mocks = await vi.hoisted(async () => {
  const { fakeAppLifecycle, fakeAppPaths } = await import('../test-support/fake-desktop-shell')
  return {
    appLifecycle: fakeAppLifecycle({ version: () => '1.2.2' }),
    appPaths: fakeAppPaths('/tmp/user-data'),
    releaseHost: { value: false },
    markUpdateQuit: vi.fn(),
    initAutoUpdater: vi.fn(),
    disposeAutoUpdater: vi.fn(),
  }
})

vi.mock('../desktop-shell/app-lifecycle', () => ({ appLifecycle: mocks.appLifecycle }))
vi.mock('../desktop-shell/app-paths', () => ({ appPaths: mocks.appPaths }))
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

    // The shell announces the installer's quit (Electrobun's updater, before it applies one).
    mocks.appLifecycle.emitBeforeQuitForUpdate()

    expect(mocks.markUpdateQuit).toHaveBeenCalledOnce()
    expect(isGuiInstallingUpdate()).toBe(true)
    disposeGuiAutoUpdater()
    expect(mocks.disposeAutoUpdater).toHaveBeenCalledOnce()
  })
})

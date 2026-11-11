import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  broadcast: vi.fn(),
  recordAttempt: vi.fn(async (..._args: unknown[]) => undefined),
  settleAttempt: vi.fn<() => Promise<unknown>>(async () => null),
}))
const engine = await vi.hoisted(async () =>
  (await import('../test-support/fake-update-engine')).fakeUpdateEngine(),
)

vi.mock('../desktop-shell/app-lifecycle', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../desktop-shell/app-lifecycle')>()
  return { appLifecycle: { ...actual.appLifecycle, isPackaged: () => true } }
})
vi.mock('@shared/build-identity-runtime', () => ({ BUILD_CHANNEL: 'beta' }))
vi.mock('../desktop-shell/update-engine', () => ({ updateEngine: engine }))
vi.mock('../utils/broadcast', () => ({
  broadcastToWindows: (...args: unknown[]) => mocks.broadcast(...args),
}))
vi.mock('../update-feed', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../update-feed')>()),
  configureUpdaterFeed: vi.fn(),
}))
vi.mock('../update-install-attempt', () => ({
  recordUpdateInstallAttempt: (...args: unknown[]) => mocks.recordAttempt(...args),
  settleUpdateInstallAttempt: () => mocks.settleAttempt(),
}))
vi.mock('../logger', () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}))

import { markUpdateQuit, shouldReleaseHostOnQuit } from '../update-install-tracker'
import {
  checkForUpdates,
  disposeAutoUpdater,
  getUpdateStatus,
  initAutoUpdater,
  installUpdate,
  isInstallingUpdate,
} from '../updater'

describe('Restart to update', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    mocks.settleAttempt.mockResolvedValue(null)
    engine.reset()
    disposeAutoUpdater()
  })

  afterEach(() => {
    vi.useRealTimers()
    disposeAutoUpdater()
    engine.reset()
  })

  it('shows the restart at once and records the attempt before handing over', async () => {
    const environment = {
      userDataDirectory: '/tmp/user-data',
      currentVersion: '1.2.2',
      bundleIdentifier: 'com.openwaggle.app',
    }
    initAutoUpdater('stable', undefined, environment)
    engine.report.downloaded('1.2.3')

    await installUpdate()

    expect(getUpdateStatus()).toEqual({ type: 'installing', version: '1.2.3' })
    expect(isInstallingUpdate()).toBe(true)
    expect(mocks.recordAttempt).toHaveBeenCalledWith('/tmp/user-data', {
      fromVersion: '1.2.2',
      toVersion: '1.2.3',
      attemptedAt: expect.any(Number),
    })
    expect(mocks.recordAttempt.mock.invocationCallOrder[0]).toBeLessThan(
      engine.quitAndInstall.mock.invocationCallOrder[0] ?? 0,
    )
  })

  it('keeps the installing state while the app quits, even through a re-check', async () => {
    initAutoUpdater('stable')
    engine.report.downloaded('1.2.3')
    await installUpdate()
    mocks.broadcast.mockClear()

    checkForUpdates()
    engine.report.checking()
    engine.report.notAvailable()

    expect(engine.checkForUpdates).not.toHaveBeenCalled()
    expect(mocks.broadcast).not.toHaveBeenCalled()
    expect(getUpdateStatus()).toEqual({ type: 'installing', version: '1.2.3' })
  })

  it('reports an installer error instead of looking like it is still restarting', async () => {
    initAutoUpdater('stable')
    engine.report.downloaded('1.2.3')
    await installUpdate()

    engine.report.error(new Error('code signature mismatch'))

    expect(isInstallingUpdate()).toBe(false)
    // The app did not quit, so the download is still there: say why and offer it again.
    expect(getUpdateStatus()).toEqual({
      type: 'downloaded',
      version: '1.2.3',
      installFailure:
        'Version 1.2.3 could not be installed: code signature mismatch. Restart to update to try again.',
    })
  })

  it('keeps the install flag through the quit, which releases the Host after disposing', async () => {
    initAutoUpdater('stable')
    engine.report.downloaded('1.2.3')
    await installUpdate()

    // before-quit disposes the updater first and asks isInstallingUpdate() afterwards.
    disposeAutoUpdater()

    expect(isInstallingUpdate()).toBe(true)
    await vi.advanceTimersByTimeAsync(10 * 60 * 1000)
    expect(getUpdateStatus()).toEqual({ type: 'installing', version: '1.2.3' })
  })

  it('reports a restart that neither quits nor fails, so it can be tried again', async () => {
    initAutoUpdater('stable')
    engine.report.downloaded('1.2.3')
    await installUpdate()

    await vi.advanceTimersByTimeAsync(3 * 60 * 1000)

    expect(isInstallingUpdate()).toBe(false)
    expect(getUpdateStatus()).toEqual({
      type: 'downloaded',
      version: '1.2.3',
      installFailure:
        'Version 1.2.3 is taking longer than expected to install. Restart to update to try again.',
    })
    // An ordinary quit from here keeps the Host; a late installer quit announces itself.
    expect(shouldReleaseHostOnQuit()).toBe(false)
    markUpdateQuit()
    expect(shouldReleaseHostOnQuit()).toBe(true)
  })

  it('keeps releasing the Host once the installer has started the quit', async () => {
    initAutoUpdater('stable')
    engine.report.downloaded('1.2.3')
    await installUpdate()
    await vi.advanceTimersByTimeAsync(3 * 60 * 1000)
    markUpdateQuit()

    // A check failing while the app quits must not cancel the release.
    engine.report.error(new Error('net::ERR_NETWORK_CHANGED'))

    expect(shouldReleaseHostOnQuit()).toBe(true)
  })

  it('lets the watchdog clear the release again on a later attempt', async () => {
    initAutoUpdater('stable')
    engine.report.downloaded('1.2.3')
    await installUpdate()
    // The installer announced a quit that did not happen, so the update is offered again.
    markUpdateQuit()
    engine.report.error(new Error('relaunch failed'))
    engine.report.downloaded('1.2.3')

    await installUpdate()
    await vi.advanceTimersByTimeAsync(3 * 60 * 1000)

    expect(shouldReleaseHostOnQuit()).toBe(false)
  })

  it('clears the release on a late installer error after the watchdog', async () => {
    initAutoUpdater('stable')
    engine.report.downloaded('1.2.3')
    await installUpdate()
    await vi.advanceTimersByTimeAsync(3 * 60 * 1000)

    engine.report.error(new Error('code signature mismatch'))

    expect(shouldReleaseHostOnQuit()).toBe(false)
  })

  it('stops releasing the Host on quit once the installer reports an error', async () => {
    initAutoUpdater('stable')
    engine.report.downloaded('1.2.3')
    await installUpdate()
    expect(shouldReleaseHostOnQuit()).toBe(true)

    engine.report.error(new Error('code signature mismatch'))

    expect(shouldReleaseHostOnQuit()).toBe(false)
  })

  it('explains why the last Restart to update did not install that version', async () => {
    mocks.settleAttempt.mockResolvedValue({
      type: 'failed',
      version: '1.2.3',
      message: 'Version 1.2.3 did not finish installing.',
    })
    initAutoUpdater('stable', undefined, {
      userDataDirectory: '/tmp/user-data',
      currentVersion: '1.2.2',
      bundleIdentifier: 'com.openwaggle.app',
    })
    await vi.advanceTimersByTimeAsync(0)

    engine.report.downloaded('1.2.3')
    expect(getUpdateStatus()).toEqual({
      type: 'downloaded',
      version: '1.2.3',
      installFailure: 'Version 1.2.3 did not finish installing.',
    })

    engine.report.downloaded('1.2.4')
    expect(getUpdateStatus()).toEqual({ type: 'downloaded', version: '1.2.4' })
  })

  it('adds the explanation when the last attempt is settled after the update is ready', async () => {
    let settle: (outcome: unknown) => void = () => undefined
    mocks.settleAttempt.mockReturnValue(new Promise((resolve) => (settle = resolve)))
    initAutoUpdater('stable', undefined, {
      userDataDirectory: '/tmp/user-data',
      currentVersion: '1.2.2',
      bundleIdentifier: 'com.openwaggle.app',
    })
    engine.report.downloaded('1.2.3')
    expect(getUpdateStatus()).toEqual({ type: 'downloaded', version: '1.2.3' })

    settle({
      type: 'failed',
      version: '1.2.3',
      message: 'Version 1.2.3 did not finish installing.',
    })
    await vi.advanceTimersByTimeAsync(0)

    expect(getUpdateStatus()).toEqual({
      type: 'downloaded',
      version: '1.2.3',
      installFailure: 'Version 1.2.3 did not finish installing.',
    })
  })
})

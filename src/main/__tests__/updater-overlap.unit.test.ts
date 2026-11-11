import type { BuildChannel } from '@shared/types/build-identity'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { UpdateEngineShape } from '../ports/desktop-shell/update-engine'

const {
  broadcastMock,
  buildChannel,
  checkForUpdatesMock,
  configureUpdaterFeedMock,
  quitAndInstallMock,
} = vi.hoisted(() => {
  const buildChannel: { value: BuildChannel } = { value: 'alpha' }
  return {
    broadcastMock: vi.fn(),
    buildChannel,
    checkForUpdatesMock: vi.fn<UpdateEngineShape['checkForUpdates']>(),
    configureUpdaterFeedMock: vi.fn(),
    quitAndInstallMock: vi.fn<UpdateEngineShape['quitAndInstall']>(),
  }
})

const engine = await vi.hoisted(async () =>
  (await import('../test-support/fake-update-engine')).fakeUpdateEngine(),
)

vi.mock('../desktop-shell/app-lifecycle', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../desktop-shell/app-lifecycle')>()
  return { appLifecycle: { ...actual.appLifecycle, isPackaged: () => true } }
})
vi.mock('@shared/build-identity-runtime', () => ({
  get BUILD_CHANNEL() {
    return buildChannel.value
  },
}))
vi.mock('../desktop-shell/update-engine', () => ({
  updateEngine: {
    ...engine,
    checkForUpdates: () => checkForUpdatesMock(),
    quitAndInstall: quitAndInstallMock,
  },
}))
vi.mock('../update-feed', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../update-feed')>()),
  configureUpdaterFeed: (...args: unknown[]) => configureUpdaterFeedMock(...args),
}))
vi.mock('../utils/broadcast', () => ({
  broadcastToWindows: (...args: unknown[]) => broadcastMock(...args),
}))
vi.mock('../logger', () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}))

import {
  checkForUpdates,
  disposeAutoUpdater,
  getUpdateStatus,
  initAutoUpdater,
  installUpdate,
  setUpdateWaitingForRuns,
} from '../updater'

describe('updater overlapping checks', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    checkForUpdatesMock.mockReset()
    configureUpdaterFeedMock.mockReset()
    // The feed lists a release, so each check goes on to ask the updater.
    configureUpdaterFeedMock.mockResolvedValue({ type: 'release', tag: 'v0.5.0-alpha.1' })
    quitAndInstallMock.mockReset()
    broadcastMock.mockReset()
    engine.reset()
    disposeAutoUpdater()
  })

  afterEach(() => {
    disposeAutoUpdater()
    engine.reset()
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('waits for an active check before checking the newly selected channel', async () => {
    let resolveFirstCheck: ((value: null) => void) | undefined
    checkForUpdatesMock.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveFirstCheck = resolve
      }),
    )
    checkForUpdatesMock.mockResolvedValue(null)
    initAutoUpdater('alpha')

    checkForUpdates('alpha')
    await vi.advanceTimersByTimeAsync(0)
    checkForUpdates('stable')
    await vi.advanceTimersByTimeAsync(0)
    expect(checkForUpdatesMock).toHaveBeenCalledOnce()
    engine.report.notAvailable()
    expect(broadcastMock).not.toHaveBeenCalled()

    resolveFirstCheck?.(null)
    await vi.advanceTimersByTimeAsync(0)

    expect(checkForUpdatesMock).toHaveBeenCalledTimes(2)
    expect(configureUpdaterFeedMock).toHaveBeenLastCalledWith(expect.anything(), 'stable')
  })

  it('ignores a stale authoritative channel read after an explicit channel check', async () => {
    let resolveRead: ((channel: 'alpha') => void) | undefined
    const readChannel = vi.fn(
      () =>
        new Promise<'alpha'>((resolve) => {
          resolveRead = resolve
        }),
    )
    checkForUpdatesMock.mockResolvedValue(null)
    initAutoUpdater('alpha', readChannel)

    checkForUpdates()
    checkForUpdates('stable')
    await Promise.resolve()
    resolveRead?.('alpha')
    await Promise.resolve()
    await Promise.resolve()

    expect(configureUpdaterFeedMock).toHaveBeenCalledTimes(1)
    expect(configureUpdaterFeedMock).toHaveBeenLastCalledWith(expect.anything(), 'stable')
    expect(engine.settings.feedChannel).toBe('latest')
  })

  it('waits for a cancelled download to settle before checking the replacement channel', async () => {
    let settleDownload: (() => void) | undefined
    const cancel = vi.fn()
    const downloadPromise = new Promise<void>((resolve) => {
      settleDownload = resolve
    })
    checkForUpdatesMock
      .mockResolvedValueOnce({
        version: '0.5.0-alpha.1',
        download: downloadPromise,
        cancelDownload: cancel,
      })
      .mockResolvedValue(null)
    initAutoUpdater('alpha')

    checkForUpdates('alpha')
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
    checkForUpdates('stable')

    expect(cancel).toHaveBeenCalledOnce()
    expect(checkForUpdatesMock).toHaveBeenCalledOnce()

    settleDownload?.()
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()

    expect(checkForUpdatesMock).toHaveBeenCalledTimes(2)
    expect(configureUpdaterFeedMock).toHaveBeenLastCalledWith(expect.anything(), 'stable')
  })

  it('finishes a Stable check and cancels a mislabelled prerelease download', async () => {
    let settleDownload: (() => void) | undefined
    const cancel = vi.fn()
    const downloadPromise = new Promise<void>((resolve) => {
      settleDownload = resolve
    })
    // The engine announces the check and the update while checkForUpdates runs.
    checkForUpdatesMock.mockImplementationOnce(async () => {
      engine.report.checking()
      engine.report.available('0.5.0-alpha.1')
      return { version: '0.5.0-alpha.1', download: downloadPromise, cancelDownload: cancel }
    })
    initAutoUpdater('stable')

    checkForUpdates('stable')
    await vi.advanceTimersByTimeAsync(0)
    engine.report.downloaded('0.5.0-alpha.1')

    expect(cancel).toHaveBeenCalledOnce()
    expect(getUpdateStatus()).toEqual({ type: 'not-available' })

    settleDownload?.()
    await Promise.resolve()
  })

  it('surfaces prerelease feed resolution failures through updater status', async () => {
    configureUpdaterFeedMock.mockRejectedValueOnce(new Error('release feed unavailable'))
    initAutoUpdater('alpha')

    checkForUpdates('alpha')
    await Promise.resolve()
    await Promise.resolve()

    expect(checkForUpdatesMock).not.toHaveBeenCalled()
    expect(broadcastMock).toHaveBeenCalledWith('updater:status-changed', {
      type: 'error',
      message: 'release feed unavailable',
    })
  })

  it('surfaces authoritative channel read failures through updater status', async () => {
    const readChannel = vi.fn().mockRejectedValue(new Error('settings unavailable'))
    initAutoUpdater('alpha', readChannel)

    checkForUpdates()
    await Promise.resolve()
    await Promise.resolve()

    expect(checkForUpdatesMock).not.toHaveBeenCalled()
    expect(broadcastMock).toHaveBeenCalledWith('updater:status-changed', {
      type: 'error',
      message: 'settings unavailable',
    })
  })

  it('installs a macOS download only on an eligible Restart action', async () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('darwin')
    checkForUpdatesMock.mockResolvedValueOnce({
      version: '0.5.0',
      download: Promise.resolve([]),
      cancelDownload: vi.fn(),
    })
    initAutoUpdater('alpha')
    engine.report.downloaded('0.5.0-alpha.1')
    expect(engine.settings.installOnQuit).toBe(false)

    checkForUpdates('stable')
    await Promise.resolve()
    engine.report.available('0.5.0')
    engine.report.downloaded('0.5.0')
    await Promise.resolve()

    expect(engine.settings.installOnQuit).toBe(false)
    expect(getUpdateStatus()).toEqual({ type: 'downloaded', version: '0.5.0' })
    await installUpdate()
    expect(quitAndInstallMock).toHaveBeenCalledWith({ silent: true, relaunch: true })
  })

  it('reports and clears how many runs Restart when idle is waiting for', () => {
    initAutoUpdater('stable')
    engine.report.downloaded('1.2.3')
    setUpdateWaitingForRuns(2)
    expect(getUpdateStatus()).toEqual({ type: 'downloaded', version: '1.2.3', waitingForRuns: 2 })
    setUpdateWaitingForRuns(null)
    expect(getUpdateStatus()).toEqual({ type: 'downloaded', version: '1.2.3' })
  })

  it('re-reads the authoritative channel before installing a downloaded update', async () => {
    const readChannel = vi.fn().mockResolvedValue('stable')
    initAutoUpdater('alpha', readChannel)
    engine.report.downloaded('0.5.0-alpha.1')

    await installUpdate()

    expect(readChannel).toHaveBeenCalledOnce()
    expect(quitAndInstallMock).not.toHaveBeenCalled()
    expect(engine.settings.installOnQuit).toBe(false)
    expect(getUpdateStatus()).toEqual({ type: 'not-available' })
  })

  it('keeps automatic install-on-quit disabled on Windows and Linux', () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('linux')

    initAutoUpdater('stable')
    engine.report.downloaded('0.4.1')

    expect(engine.settings.installOnQuit).toBe(false)
  })
})

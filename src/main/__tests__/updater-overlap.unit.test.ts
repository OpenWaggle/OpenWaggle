import type { BuildChannel } from '@shared/types/build-identity'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { broadcastMock, buildChannel, checkForUpdatesMock, configureUpdaterFeedMock, updaterRef } =
  vi.hoisted(() => {
    const updaterRef: { current: import('node:events').EventEmitter | null } = { current: null }
    const buildChannel: { value: BuildChannel } = { value: 'alpha' }
    return {
      broadcastMock: vi.fn(),
      buildChannel,
      checkForUpdatesMock: vi.fn<() => Promise<unknown>>(),
      configureUpdaterFeedMock: vi.fn(),
      updaterRef,
    }
  })

vi.mock('@electron-toolkit/utils', () => ({ is: { dev: false } }))
vi.mock('@shared/build-identity-runtime', () => ({
  get BUILD_CHANNEL() {
    return buildChannel.value
  },
}))
vi.mock('electron-updater', async () => {
  const { EventEmitter } = await import('node:events')
  const updater = Object.assign(new EventEmitter(), {
    allowDowngrade: false,
    allowPrerelease: false,
    autoDownload: true,
    autoInstallOnAppQuit: true,
    logger: null,
    checkForUpdates: () => checkForUpdatesMock(),
    quitAndInstall: vi.fn(),
  })
  updaterRef.current = updater
  return { autoUpdater: updater }
})
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
} from '../updater'

describe('updater overlapping checks', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    checkForUpdatesMock.mockReset()
    configureUpdaterFeedMock.mockReset()
    broadcastMock.mockReset()
    updaterRef.current?.removeAllListeners()
    disposeAutoUpdater()
  })

  afterEach(() => {
    disposeAutoUpdater()
    updaterRef.current?.removeAllListeners()
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('waits for an active check before checking the newly selected channel', async () => {
    let resolveFirstCheck: ((value: { readonly isUpdateAvailable: false }) => void) | undefined
    checkForUpdatesMock.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveFirstCheck = resolve
      }),
    )
    checkForUpdatesMock.mockResolvedValue(undefined)
    initAutoUpdater('alpha')

    checkForUpdates('alpha')
    checkForUpdates('stable')
    expect(checkForUpdatesMock).toHaveBeenCalledOnce()
    updaterRef.current?.emit('update-not-available')
    expect(broadcastMock).not.toHaveBeenCalled()

    resolveFirstCheck?.({ isUpdateAvailable: false })
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()

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
    checkForUpdatesMock.mockResolvedValue(undefined)
    initAutoUpdater('alpha', readChannel)

    checkForUpdates()
    checkForUpdates('stable')
    await Promise.resolve()
    resolveRead?.('alpha')
    await Promise.resolve()
    await Promise.resolve()

    expect(configureUpdaterFeedMock).toHaveBeenCalledTimes(1)
    expect(configureUpdaterFeedMock).toHaveBeenLastCalledWith(expect.anything(), 'stable')
    expect(Reflect.get(updaterRef.current ?? {}, 'channel')).toBe('latest')
  })

  it('waits for a cancelled download to settle before checking the replacement channel', async () => {
    let settleDownload: (() => void) | undefined
    const cancel = vi.fn()
    const downloadPromise = new Promise<void>((resolve) => {
      settleDownload = resolve
    })
    checkForUpdatesMock
      .mockResolvedValueOnce({
        cancellationToken: { cancel },
        downloadPromise,
        isUpdateAvailable: true,
        updateInfo: { version: '0.5.0-alpha.1' },
      })
      .mockResolvedValue(undefined)
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
    checkForUpdatesMock.mockResolvedValueOnce({
      isUpdateAvailable: true,
      updateInfo: { version: '0.5.0-alpha.1' },
      cancellationToken: { cancel },
      downloadPromise,
    })
    initAutoUpdater('stable')

    checkForUpdates('stable')
    updaterRef.current?.emit('checking-for-update')
    updaterRef.current?.emit('update-available', { version: '0.5.0-alpha.1' })
    await Promise.resolve()
    await Promise.resolve()
    updaterRef.current?.emit('update-downloaded', { version: '0.5.0-alpha.1' })

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

  it('keeps macOS downloads out of Squirrel until an eligible Restart action', async () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('darwin')
    checkForUpdatesMock.mockResolvedValueOnce({
      isUpdateAvailable: true,
      updateInfo: { version: '0.5.0' },
      downloadPromise: Promise.resolve([]),
    })
    initAutoUpdater('alpha')
    updaterRef.current?.emit('update-downloaded', { version: '0.5.0-alpha.1' })
    expect(Reflect.get(updaterRef.current ?? {}, 'autoInstallOnAppQuit')).toBe(false)

    checkForUpdates('stable')
    await Promise.resolve()
    updaterRef.current?.emit('update-available', { version: '0.5.0' })
    updaterRef.current?.emit('update-downloaded', { version: '0.5.0' })
    await Promise.resolve()

    expect(Reflect.get(updaterRef.current ?? {}, 'autoInstallOnAppQuit')).toBe(false)
    expect(getUpdateStatus()).toEqual({ type: 'downloaded', version: '0.5.0' })
    installUpdate()
    expect(Reflect.get(updaterRef.current ?? {}, 'quitAndInstall')).toHaveBeenCalledWith(
      false,
      true,
    )
  })
})

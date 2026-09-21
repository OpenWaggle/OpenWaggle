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

import { checkForUpdates, disposeAutoUpdater, initAutoUpdater } from '../updater'

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
})

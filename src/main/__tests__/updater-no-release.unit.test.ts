import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { broadcastMock, checkForUpdatesMock, configureUpdaterFeedMock } = vi.hoisted(() => ({
  broadcastMock: vi.fn(),
  checkForUpdatesMock: vi.fn<() => Promise<unknown>>(),
  configureUpdaterFeedMock: vi.fn(),
}))

vi.mock('@electron-toolkit/utils', () => ({ is: { dev: false } }))
vi.mock('@shared/build-identity-runtime', () => ({ BUILD_CHANNEL: 'beta' }))
vi.mock('electron-updater', async () => {
  const { EventEmitter } = await import('node:events')
  return {
    autoUpdater: Object.assign(new EventEmitter(), {
      allowDowngrade: false,
      allowPrerelease: false,
      autoDownload: true,
      autoInstallOnAppQuit: false,
      logger: null,
      checkForUpdates: () => checkForUpdatesMock(),
      quitAndInstall: vi.fn(),
    }),
  }
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

import { checkForUpdates, disposeAutoUpdater, getUpdateStatus, initAutoUpdater } from '../updater'

describe('updater channel without a release', () => {
  beforeEach(() => {
    checkForUpdatesMock.mockReset()
    checkForUpdatesMock.mockResolvedValue(undefined)
    configureUpdaterFeedMock.mockReset()
    broadcastMock.mockReset()
    disposeAutoUpdater()
  })

  afterEach(() => {
    disposeAutoUpdater()
  })

  it('shows up to date, not an error, when the channel has no release yet', async () => {
    // Stable before 1.0.0: the release list has only prereleases.
    configureUpdaterFeedMock.mockResolvedValue({ type: 'no-release' })
    initAutoUpdater('stable')

    checkForUpdates('stable')
    await vi.waitFor(() => expect(getUpdateStatus()).toEqual({ type: 'not-available' }))

    expect(checkForUpdatesMock).not.toHaveBeenCalled()
    expect(broadcastMock).not.toHaveBeenCalledWith(
      'updater:status-changed',
      expect.objectContaining({ type: 'error' }),
    )
  })

  it('clears an earlier failed check once the channel is known to have no release', async () => {
    configureUpdaterFeedMock.mockRejectedValueOnce(new Error('release list unavailable'))
    initAutoUpdater('stable')
    checkForUpdates('stable')
    await vi.waitFor(() => expect(getUpdateStatus().type).toBe('error'))

    configureUpdaterFeedMock.mockResolvedValue({ type: 'no-release' })
    checkForUpdates('stable')

    await vi.waitFor(() => expect(getUpdateStatus()).toEqual({ type: 'not-available' }))
  })

  it('checks the selected release when the channel has one', async () => {
    configureUpdaterFeedMock.mockResolvedValue({ type: 'release', tag: 'v1.0.0-beta.25' })
    initAutoUpdater('beta')

    checkForUpdates('beta')

    await vi.waitFor(() => expect(checkForUpdatesMock).toHaveBeenCalledOnce())
  })
})

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const {
  checkForUpdatesMock,
  executeLocalSessionCommandMock,
  configureUpdaterFeedMock,
  quitAndInstallMock,
  writeCliStdoutMock,
  createClientMock,
  requestSingleInstanceLockMock,
  releaseSingleInstanceLockMock,
  spawnMock,
  stopHostForUpdateMock,
  updater,
} = vi.hoisted(() => {
  const updater: {
    channel: string | null
    allowPrerelease: boolean
    allowDowngrade: boolean
    autoDownload: boolean
    autoInstallOnAppQuit: boolean
    logger: null
    once: ReturnType<typeof vi.fn>
    off: ReturnType<typeof vi.fn>
  } = {
    channel: null,
    allowPrerelease: false,
    allowDowngrade: false,
    autoDownload: true,
    autoInstallOnAppQuit: true,
    logger: null,
    once: vi.fn(),
    off: vi.fn(),
  }
  return {
    checkForUpdatesMock: vi.fn(),
    executeLocalSessionCommandMock: vi.fn(),
    configureUpdaterFeedMock: vi.fn(),
    quitAndInstallMock: vi.fn(),
    writeCliStdoutMock: vi.fn(() => Promise.resolve()),
    createClientMock: vi.fn(() => Promise.resolve({ clientKind: 'cli' })),
    requestSingleInstanceLockMock: vi.fn(() => true),
    releaseSingleInstanceLockMock: vi.fn(),
    spawnMock: vi.fn(),
    stopHostForUpdateMock: vi.fn(),
    updater,
  }
})

vi.mock('node:child_process', () => ({ spawn: spawnMock }))
vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getAppPath: () => '/workspace/OpenWaggle',
    requestSingleInstanceLock: requestSingleInstanceLockMock,
    releaseSingleInstanceLock: releaseSingleInstanceLockMock,
  },
}))
vi.mock('electron-updater', () => ({
  autoUpdater: Object.assign(updater, {
    checkForUpdates: checkForUpdatesMock,
    quitAndInstall: quitAndInstallMock,
  }),
}))
vi.mock('../session-host/local-session-client', () => ({
  executeLocalSessionCommand: executeLocalSessionCommandMock,
}))
vi.mock('../update-feed', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../update-feed')>()),
  configureUpdaterFeed: (...args: unknown[]) => configureUpdaterFeedMock(...args),
}))
vi.mock('../local-session-cli-client', () => ({
  createLocalSessionCliClientInput: createClientMock,
}))
vi.mock('../cli-stdout', () => ({ writeCliStdout: writeCliStdoutMock }))
vi.mock('../host-cli', () => ({ stopHostForUpdate: stopHostForUpdateMock }))
vi.mock('../host-update-stop', () => ({ formatHostUpdateStopReport: () => 'Session Host report' }))

import { runUpdateCli } from '../update-cli'

describe('update CLI with the desktop app', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    updater.channel = null
    updater.allowPrerelease = false
    updater.allowDowngrade = false
    updater.autoDownload = true
    executeLocalSessionCommandMock.mockImplementation(
      ({ payload }: { readonly payload: { readonly request: { readonly operation: string } } }) =>
        Promise.resolve({
          contract: 'local-update-v1',
          response: {
            contractVersion: 1,
            updateChannel: payload.request.operation === 'set-channel' ? 'alpha' : 'stable',
          },
        }),
    )
    checkForUpdatesMock.mockResolvedValue(null)
    configureUpdaterFeedMock.mockReset()
    requestSingleInstanceLockMock.mockReturnValue(true)
    stopHostForUpdateMock.mockResolvedValue({ state: 'stopped', activeRuns: 0 })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('installs silently without opening the app when the desktop app is closed', async () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('linux')
    updater.once.mockImplementation((event: string, listener: () => void) => {
      if (event === 'update-downloaded') queueMicrotask(listener)
      return updater
    })
    checkForUpdatesMock.mockResolvedValue({
      isUpdateAvailable: true,
      updateInfo: { version: '0.4.1' },
    })

    await expect(runUpdateCli([])).resolves.toEqual({ exitCode: 0, updaterOwnsExit: true })

    expect(updater.autoDownload).toBe(true)
    expect(releaseSingleInstanceLockMock).toHaveBeenCalledOnce()
    // The old version's Host stops first, as it does for Restart to update.
    expect(stopHostForUpdateMock).toHaveBeenCalledOnce()
    expect(stopHostForUpdateMock.mock.invocationCallOrder[0]).toBeLessThan(
      quitAndInstallMock.mock.invocationCallOrder[0] ?? 0,
    )
    expect(quitAndInstallMock).toHaveBeenCalledWith(true, false)
  })

  it('does not install when the user cancels because agent runs are active', async () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('linux')
    vi.spyOn(process.stderr, 'write').mockReturnValue(true)
    updater.once.mockImplementation((event: string, listener: () => void) => {
      if (event === 'update-downloaded') queueMicrotask(listener)
      return updater
    })
    checkForUpdatesMock.mockResolvedValue({
      isUpdateAvailable: true,
      updateInfo: { version: '0.4.1' },
    })
    stopHostForUpdateMock.mockResolvedValue({ state: 'cancelled', activeRuns: 1 })

    await expect(runUpdateCli([])).resolves.toEqual({ exitCode: 1, updaterOwnsExit: false })
    expect(process.stderr.write).toHaveBeenCalledWith(
      'error: Update cancelled. OpenWaggle was not changed.\n',
    )
    expect(quitAndInstallMock).not.toHaveBeenCalled()
  })

  it('installs through the bundled installer on macOS, where Squirrel always relaunches', async () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('darwin')
    spawnMock.mockImplementation(() => ({
      once: (event: string, listener: (code: number) => void) => {
        if (event === 'exit') queueMicrotask(() => listener(0))
      },
    }))
    checkForUpdatesMock.mockResolvedValue({
      isUpdateAvailable: true,
      updateInfo: { version: '0.4.1' },
    })

    await expect(runUpdateCli([])).resolves.toEqual({ exitCode: 0, updaterOwnsExit: false })

    expect(updater.autoDownload).toBe(false)
    expect(quitAndInstallMock).not.toHaveBeenCalled()
    // The install script stops the Host itself, after it quits the app.
    expect(stopHostForUpdateMock).not.toHaveBeenCalled()
    expect(spawnMock).toHaveBeenCalledWith(
      'bash',
      [expect.stringMatching(/install\.sh$/u)],
      expect.objectContaining({
        env: expect.objectContaining({
          OPENWAGGLE_RELEASE_TAG: 'v0.4.1',
          OPENWAGGLE_NO_LAUNCH: '1',
        }),
      }),
    )
  })

  it('refuses an exact-version install while the desktop app is open', async () => {
    requestSingleInstanceLockMock.mockReturnValue(false)
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ tag_name: 'v0.4.0', assets: [] }),
        }),
      ),
    )
    const stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true)

    await expect(runUpdateCli(['--version', '0.4.0'])).resolves.toEqual({
      exitCode: 1,
      updaterOwnsExit: false,
    })
    expect(stderr).toHaveBeenCalledWith(
      expect.stringContaining('OpenWaggle is open. Quit it first'),
    )
    expect(spawnMock).not.toHaveBeenCalled()
  })

  it('leaves installation to a running desktop app so it can protect active runs', async () => {
    requestSingleInstanceLockMock.mockReturnValue(false)
    checkForUpdatesMock.mockResolvedValue({
      isUpdateAvailable: true,
      updateInfo: { version: '0.4.1' },
    })

    await expect(runUpdateCli([])).resolves.toEqual({ exitCode: 0, updaterOwnsExit: false })

    expect(requestSingleInstanceLockMock).toHaveBeenCalledWith({
      openwaggleInstanceProbe: 'update-cli',
    })
    expect(releaseSingleInstanceLockMock).not.toHaveBeenCalled()
    expect(updater.autoDownload).toBe(false)
    expect(updater.autoInstallOnAppQuit).toBe(false)
    expect(quitAndInstallMock).not.toHaveBeenCalled()
    expect(writeCliStdoutMock).toHaveBeenCalledWith(
      expect.stringContaining('Check now, then Restart to update'),
    )
  })
})

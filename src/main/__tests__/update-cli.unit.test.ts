import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const {
  checkForUpdatesMock,
  executeLocalSessionCommandMock,
  configureUpdaterFeedMock,
  quitAndInstallMock,
  writeCliStdoutMock,
  createClientMock,
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
    updater,
  }
})

vi.mock('electron', () => ({
  app: { isPackaged: false, getAppPath: () => '/workspace/OpenWaggle' },
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

import { runUpdateCli } from '../update-cli'

describe('update CLI', () => {
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
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('shows help without starting the Session Host', async () => {
    await expect(runUpdateCli(['--help'])).resolves.toEqual({
      exitCode: 0,
      updaterOwnsExit: false,
    })
    expect(createClientMock).not.toHaveBeenCalled()
    expect(writeCliStdoutMock).toHaveBeenCalledWith(expect.stringContaining('openwaggle update'))
  })

  it('persists an explicit channel and checks its matching updater feed', async () => {
    checkForUpdatesMock.mockResolvedValue({
      isUpdateAvailable: true,
      updateInfo: { version: '0.5.0-alpha.2' },
    })

    await expect(runUpdateCli(['--channel', 'alpha', '--check'])).resolves.toEqual({
      exitCode: 0,
      updaterOwnsExit: false,
    })

    expect(createClientMock).toHaveBeenCalledWith(expect.anything(), {
      supportedRevisions: [14],
    })
    expect(executeLocalSessionCommandMock).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: {
          contract: 'local-update-v1',
          request: { contractVersion: 1, operation: 'set-channel', channel: 'alpha' },
        },
      }),
    )
    expect(updater.channel).toBe('alpha')
    expect(updater.allowPrerelease).toBe(true)
    expect(updater.allowDowngrade).toBe(false)
    expect(updater.autoDownload).toBe(false)
    expect(writeCliStdoutMock).toHaveBeenCalledWith(
      'OpenWaggle 0.5.0-alpha.2 is available on the alpha channel.\n',
    )
  })

  it('uses the saved GUI channel when no CLI override is provided', async () => {
    executeLocalSessionCommandMock.mockResolvedValue({
      contract: 'local-update-v1',
      response: { contractVersion: 1, updateChannel: 'beta' },
    })

    await expect(runUpdateCli(['--check'])).resolves.toEqual({
      exitCode: 0,
      updaterOwnsExit: false,
    })

    expect(updater.channel).toBe('beta')
    expect(configureUpdaterFeedMock).toHaveBeenCalledWith(updater, 'beta')
    expect(executeLocalSessionCommandMock).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: {
          contract: 'local-update-v1',
          request: { contractVersion: 1, operation: 'get-channel' },
        },
      }),
    )
    expect(writeCliStdoutMock).toHaveBeenCalledWith(
      'OpenWaggle is up to date on the beta channel.\n',
    )
  })

  it('reports no update when the feed metadata describes the installed version', async () => {
    checkForUpdatesMock.mockResolvedValue({
      isUpdateAvailable: false,
      updateInfo: { version: '0.4.0' },
    })

    await expect(runUpdateCli(['--check'])).resolves.toEqual({
      exitCode: 0,
      updaterOwnsExit: false,
    })
    expect(writeCliStdoutMock).toHaveBeenCalledWith(
      'OpenWaggle is up to date on the stable channel.\n',
    )
  })

  it('rejects an update that is ineligible for the selected channel', async () => {
    checkForUpdatesMock.mockResolvedValue({
      isUpdateAvailable: true,
      updateInfo: { version: '0.5.0-alpha.2' },
    })

    await expect(runUpdateCli(['--check'])).resolves.toEqual({
      exitCode: 1,
      updaterOwnsExit: false,
    })
    expect(writeCliStdoutMock).not.toHaveBeenCalledWith(
      expect.stringContaining('0.5.0-alpha.2 is available'),
    )
  })

  it('cancels an ineligible channel download without installing it', async () => {
    const cancel = vi.fn()
    checkForUpdatesMock.mockResolvedValue({
      cancellationToken: { cancel },
      downloadPromise: Promise.reject(new Error('cancelled')),
      isUpdateAvailable: true,
      updateInfo: { version: '0.5.0-alpha.2' },
    })

    await expect(runUpdateCli([])).resolves.toEqual({
      exitCode: 1,
      updaterOwnsExit: false,
    })

    expect(cancel).toHaveBeenCalledOnce()
    expect(updater.autoInstallOnAppQuit).toBe(false)
    expect(updater.off).toHaveBeenCalledWith('update-downloaded', expect.any(Function))
    expect(updater.off).toHaveBeenCalledWith('error', expect.any(Function))
    expect(quitAndInstallMock).not.toHaveBeenCalled()
    expect(writeCliStdoutMock).not.toHaveBeenCalledWith(
      expect.stringMatching(/Downloading|Installing/u),
    )
  })

  it('checks an exact version without changing the saved channel', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ tag_name: 'v0.4.0', assets: [] }),
        }),
      ),
    )

    await expect(runUpdateCli(['--version', '0.4.0', '--check'])).resolves.toEqual({
      exitCode: 0,
      updaterOwnsExit: false,
    })
    expect(createClientMock).not.toHaveBeenCalled()
    expect(writeCliStdoutMock).toHaveBeenCalledWith('OpenWaggle v0.4.0 is available.\n')
  })

  it('distinguishes invalid arguments from update failures', async () => {
    await expect(runUpdateCli(['--channel', 'nightly'])).resolves.toEqual({
      exitCode: 2,
      updaterOwnsExit: false,
    })

    checkForUpdatesMock.mockRejectedValueOnce(new Error('feed unavailable'))
    await expect(runUpdateCli(['--check'])).resolves.toEqual({
      exitCode: 1,
      updaterOwnsExit: false,
    })
  })
})

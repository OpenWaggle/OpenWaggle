import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const {
  executeLocalSessionCommandMock,
  configureUpdaterFeedMock,
  writeCliStdoutMock,
  createClientMock,
  requestSingleInstanceLockMock,
  releaseSingleInstanceLockMock,
  spawnMock,
  stopHostForUpdateMock,
} = vi.hoisted(() => ({
  executeLocalSessionCommandMock: vi.fn(),
  configureUpdaterFeedMock: vi.fn(),
  writeCliStdoutMock: vi.fn(() => Promise.resolve()),
  createClientMock: vi.fn(() => Promise.resolve({ clientKind: 'cli' })),
  requestSingleInstanceLockMock: vi.fn(() => true),
  releaseSingleInstanceLockMock: vi.fn(),
  spawnMock: vi.fn(),
  stopHostForUpdateMock: vi.fn(),
}))
const engine = await vi.hoisted(async () =>
  (await import('../test-support/fake-update-engine')).fakeUpdateEngine(),
)

vi.mock('node:child_process', () => ({ spawn: spawnMock }))
vi.mock('../desktop-shell/app-lifecycle', async () => ({
  appLifecycle: (await import('../test-support/fake-desktop-shell')).fakeAppLifecycle({
    version: () => '1.0.0-beta.25',
  }),
}))
vi.mock('../desktop-shell/app-paths', async () => ({
  appPaths: (await import('../test-support/fake-desktop-shell')).fakeAppPaths(
    '/tmp/openwaggle-profile',
  ),
}))
vi.mock('../desktop-shell/system-integration', async () => ({
  systemIntegration: (await import('../test-support/fake-desktop-shell')).fakeSystemIntegration({
    requestSingleInstanceLock: requestSingleInstanceLockMock,
    releaseSingleInstanceLock: releaseSingleInstanceLockMock,
  }),
}))
vi.mock('../desktop-shell/update-engine', () => ({ updateEngine: engine }))
vi.mock('../session-host/local-session-client', () => ({
  executeLocalSessionCommand: executeLocalSessionCommandMock,
}))
vi.mock('../update-feed', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../update-feed')>()),
  configureUpdaterFeed: (...args: unknown[]) => configureUpdaterFeedMock(...args),
}))
vi.mock('../local-session-cli-client', () => ({
  createLocalSessionCliClientInput: createClientMock,
  assertCliAgentMayUseOwnerAuthority: vi.fn(),
}))
vi.mock('../cli-stdout', () => ({ writeCliStdout: writeCliStdoutMock }))
vi.mock('../host-cli', () => ({ stopHostForUpdate: stopHostForUpdateMock }))
vi.mock('../host-update-stop', () => ({ formatHostUpdateStopReport: () => 'Session Host report' }))

import { runUpdateCli } from '../update-cli'

describe('update CLI', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    engine.reset()
    executeLocalSessionCommandMock.mockImplementation(
      ({
        payload,
      }: {
        readonly payload: {
          readonly request: { readonly operation: string; readonly channel?: string }
        }
      }) =>
        Promise.resolve({
          contract: 'local-update-v1',
          response: {
            contractVersion: 1,
            updateChannel: payload.request.channel ?? 'stable',
          },
        }),
    )
    configureUpdaterFeedMock.mockReset()
    configureUpdaterFeedMock.mockResolvedValue({ type: 'release', tag: 'v1.0.0-beta.25' })
    requestSingleInstanceLockMock.mockReturnValue(true)
    stopHostForUpdateMock.mockResolvedValue({ state: 'stopped', activeRuns: 0 })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('shows help without starting the Session Host', async () => {
    await expect(runUpdateCli(['--help'])).resolves.toEqual({
      exitCode: 0,
      updaterOwnsExit: false,
    })
    expect(createClientMock).not.toHaveBeenCalled()
    expect(writeCliStdoutMock).toHaveBeenCalledWith(expect.stringContaining('openwaggle update'))
  })

  it('checks an explicit channel without saving it', async () => {
    engine.offer('1.0.0-rc.1', null)

    await expect(runUpdateCli(['--channel', 'alpha', '--check'])).resolves.toEqual({
      exitCode: 0,
      updaterOwnsExit: false,
    })

    // --check is read-only: the saved channel is neither changed nor needed.
    expect(executeLocalSessionCommandMock).not.toHaveBeenCalled()
    expect(createClientMock).not.toHaveBeenCalled()
    expect(configureUpdaterFeedMock).toHaveBeenCalledWith(engine, 'alpha')
    expect(engine.settings).toMatchObject({
      feedChannel: 'alpha',
      allowPrerelease: true,
      autoDownload: false,
    })
    expect(writeCliStdoutMock).toHaveBeenCalledWith(
      'OpenWaggle 1.0.0-rc.1 is available on the alpha channel. The saved update channel was not changed.\n',
    )
  })

  it('persists an explicit channel when it updates from it', async () => {
    await expect(runUpdateCli(['--channel', 'alpha'])).resolves.toEqual({
      exitCode: 0,
      updaterOwnsExit: false,
    })

    // No pinned revision: the command offers those it can be sent at, the Host's current one.
    expect(createClientMock).toHaveBeenCalledWith(expect.anything(), {
      agentRefusal: expect.stringContaining('Ask the user to run openwaggle update'),
    })
    expect(executeLocalSessionCommandMock).toHaveBeenCalledWith(
      expect.not.objectContaining({ supportedRevisions: expect.anything() }),
    )
    expect(executeLocalSessionCommandMock).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: {
          contract: 'local-update-v1',
          request: { contractVersion: 1, operation: 'set-channel', channel: 'alpha' },
        },
      }),
    )
    expect(configureUpdaterFeedMock).toHaveBeenCalledWith(engine, 'alpha')
    expect(writeCliStdoutMock).toHaveBeenCalledWith(
      'OpenWaggle is up to date on the alpha channel.\n',
    )
  })

  it.each([
    [['--channel', 'stable', '--check'], ' The saved update channel was not changed.'],
    [['--channel', 'stable'], ''],
  ])('reports Stable before its first release as up to date: %j', async (args, unsaved) => {
    configureUpdaterFeedMock.mockResolvedValue({ type: 'no-release' })

    await expect(runUpdateCli(args)).resolves.toEqual({ exitCode: 0, updaterOwnsExit: false })

    expect(engine.checkForUpdates).not.toHaveBeenCalled()
    expect(writeCliStdoutMock).toHaveBeenCalledWith(
      `OpenWaggle is up to date on the stable channel: no release is available on it yet.${unsaved}\n`,
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

    expect(engine.settings.feedChannel).toBe('beta')
    expect(configureUpdaterFeedMock).toHaveBeenCalledWith(engine, 'beta')
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

  it('rejects an update that is ineligible for the selected channel', async () => {
    engine.offer('0.5.0-alpha.2', null)

    await expect(runUpdateCli(['--check'])).resolves.toEqual({
      exitCode: 1,
      updaterOwnsExit: false,
    })
    expect(writeCliStdoutMock).not.toHaveBeenCalledWith(
      expect.stringContaining('0.5.0-alpha.2 is available'),
    )
  })

  it('cancels an ineligible channel download without installing it', async () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('linux')
    const { cancelDownload } = engine.offer('0.5.0-alpha.2', Promise.reject(new Error('cancelled')))

    await expect(runUpdateCli([])).resolves.toEqual({
      exitCode: 1,
      updaterOwnsExit: false,
    })

    expect(cancelDownload).toHaveBeenCalledOnce()
    expect(engine.settings.installOnQuit).toBe(false)
    // The download waiter stopped listening.
    expect(engine.listenerCounts()).toMatchObject({ downloaded: 0, error: 0 })
    expect(engine.quitAndInstall).not.toHaveBeenCalled()
    expect(writeCliStdoutMock).not.toHaveBeenCalledWith(
      expect.stringMatching(/Downloading|Installing/u),
    )
  })

  it('refuses a downgrade with a usage error before contacting GitHub', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true)

    await expect(runUpdateCli(['--version', '1.0.0-beta.20', '--check'])).resolves.toEqual({
      exitCode: 2,
      updaterOwnsExit: false,
    })

    expect(fetchMock).not.toHaveBeenCalled()
    expect(writeCliStdoutMock).not.toHaveBeenCalled()
    expect(stderr).toHaveBeenCalledWith(expect.stringMatching(/^error \[usage\]: .*Downgrades/u))
  })

  it('distinguishes invalid arguments from update failures', async () => {
    await expect(runUpdateCli(['--channel', 'nightly'])).resolves.toEqual({
      exitCode: 2,
      updaterOwnsExit: false,
    })

    engine.checkForUpdates.mockRejectedValueOnce(new Error('feed unavailable'))
    await expect(runUpdateCli(['--check'])).resolves.toEqual({
      exitCode: 1,
      updaterOwnsExit: false,
    })
  })

  it('does not leave the download waiter rejection unhandled when a check fails', async () => {
    const unhandled: unknown[] = []
    const onUnhandled = (reason: unknown) => unhandled.push(reason)
    process.on('unhandledRejection', onUnhandled)
    try {
      engine.checkForUpdates.mockImplementation(() => {
        engine.report.error(new Error('download failed'))
        return Promise.reject(new Error('metadata failed'))
      })

      await expect(runUpdateCli([])).resolves.toEqual({
        exitCode: 1,
        updaterOwnsExit: false,
      })
      await new Promise<void>((resolve) => setImmediate(resolve))

      expect(unhandled).toEqual([])
    } finally {
      process.off('unhandledRejection', onUnhandled)
    }
  })
})

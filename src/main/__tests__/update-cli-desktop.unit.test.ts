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
  appOnMock,
} = vi.hoisted(() => ({
  executeLocalSessionCommandMock: vi.fn(),
  configureUpdaterFeedMock: vi.fn(),
  writeCliStdoutMock: vi.fn(() => Promise.resolve()),
  createClientMock: vi.fn(() => Promise.resolve({ clientKind: 'cli' })),
  requestSingleInstanceLockMock: vi.fn(() => true),
  releaseSingleInstanceLockMock: vi.fn(),
  spawnMock: vi.fn(),
  stopHostForUpdateMock: vi.fn(),
  appOnMock: vi.fn(),
}))
const engine = await vi.hoisted(async () =>
  (await import('../test-support/fake-update-engine')).fakeUpdateEngine(),
)

/** The engine finds `version` and reports it downloaded right after the check. */
function offerDownloaded(version: string) {
  engine.checkForUpdates.mockImplementation(async () => {
    queueMicrotask(() => engine.report.downloaded(version))
    return { version, download: Promise.resolve(), cancelDownload: vi.fn() }
  })
}

vi.mock('node:child_process', () => ({ spawn: spawnMock }))
vi.mock('../desktop-shell/app-lifecycle', async () => ({
  appLifecycle: (await import('../test-support/fake-desktop-shell')).fakeAppLifecycle({
    version: () => '0.3.0',
    onBeforeQuit: (listener) => {
      appOnMock('before-quit', listener)
      return () => undefined
    },
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

describe('update CLI with the desktop app', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    engine.reset()
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
    configureUpdaterFeedMock.mockReset()
    configureUpdaterFeedMock.mockResolvedValue({ type: 'release', tag: 'v0.4.1' })
    requestSingleInstanceLockMock.mockReturnValue(true)
    stopHostForUpdateMock.mockResolvedValue({ state: 'stopped', activeRuns: 0 })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('installs silently without opening the app when the desktop app is closed', async () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('linux')
    offerDownloaded('0.4.1')

    await expect(runUpdateCli([])).resolves.toEqual({ exitCode: 0, updaterOwnsExit: true })

    expect(engine.settings.autoDownload).toBe(true)
    expect(releaseSingleInstanceLockMock).toHaveBeenCalledOnce()
    // The old version's Host stops first, as it does for Restart to update.
    expect(stopHostForUpdateMock).toHaveBeenCalledOnce()
    expect(stopHostForUpdateMock.mock.invocationCallOrder[0]).toBeLessThan(
      engine.quitAndInstall.mock.invocationCallOrder[0] ?? 0,
    )
    expect(engine.quitAndInstall).toHaveBeenCalledWith({ silent: true, relaunch: false })
  })

  it('does not install when the user cancels because agent runs are active', async () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('linux')
    vi.spyOn(process.stderr, 'write').mockReturnValue(true)
    offerDownloaded('0.4.1')
    stopHostForUpdateMock.mockResolvedValue({ state: 'cancelled', activeRuns: 1 })

    // A conflict (exit 6), as `host stop --update` reports a cancel (#351).
    await expect(runUpdateCli([])).resolves.toEqual({ exitCode: 6, updaterOwnsExit: false })
    expect(process.stderr.write).toHaveBeenCalledWith(
      'error [conflict]: Update cancelled. OpenWaggle was not changed.\n',
    )
    expect(engine.quitAndInstall).not.toHaveBeenCalled()
  })

  it('installs through the bundled installer on macOS, where the engine always relaunches', async () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('darwin')
    spawnMock.mockImplementation(() => ({
      once: (event: string, listener: (code: number) => void) => {
        if (event === 'exit') queueMicrotask(() => listener(0))
      },
    }))
    engine.offer('0.4.1', null)

    await expect(runUpdateCli([])).resolves.toEqual({ exitCode: 0, updaterOwnsExit: false })

    expect(engine.settings.autoDownload).toBe(false)
    expect(engine.quitAndInstall).not.toHaveBeenCalled()
    // The install script stops the Host itself, after it quits the app.
    expect(stopHostForUpdateMock).not.toHaveBeenCalled()
    // Ctrl-C reaches the install script, which cancels; this process waits for its status.
    expect(appOnMock).toHaveBeenCalledWith('before-quit', expect.any(Function))
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
      exitCode: 6,
      updaterOwnsExit: false,
    })
    expect(stderr).toHaveBeenCalledWith(
      expect.stringContaining('error [conflict]: OpenWaggle is open. Quit it first'),
    )
    expect(spawnMock).not.toHaveBeenCalled()
  })

  it('leaves installation to a running desktop app so it can protect active runs', async () => {
    requestSingleInstanceLockMock.mockReturnValue(false)
    engine.offer('0.4.1', null)

    await expect(runUpdateCli([])).resolves.toEqual({ exitCode: 0, updaterOwnsExit: false })

    expect(requestSingleInstanceLockMock).toHaveBeenCalledWith({
      openwaggleInstanceProbe: 'update-cli',
    })
    expect(releaseSingleInstanceLockMock).not.toHaveBeenCalled()
    expect(engine.settings.autoDownload).toBe(false)
    expect(engine.settings.installOnQuit).toBe(false)
    expect(engine.quitAndInstall).not.toHaveBeenCalled()
    expect(writeCliStdoutMock).toHaveBeenCalledWith(
      expect.stringContaining('Check now, then Restart to update'),
    )
  })
})

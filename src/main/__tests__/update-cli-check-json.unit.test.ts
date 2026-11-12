import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const {
  checkForUpdatesMock,
  configureUpdaterFeedMock,
  executeLocalSessionCommandMock,
  quitAndInstallMock,
  writeCliStdoutMock,
  createClientMock,
  updater,
} = vi.hoisted(() => ({
  checkForUpdatesMock: vi.fn(),
  configureUpdaterFeedMock: vi.fn(),
  executeLocalSessionCommandMock: vi.fn(),
  quitAndInstallMock: vi.fn(),
  writeCliStdoutMock: vi.fn((_value: string) => Promise.resolve()),
  createClientMock: vi.fn(() => Promise.resolve({ clientKind: 'cli' })),
  updater: {
    channel: null,
    allowPrerelease: false,
    allowDowngrade: false,
    autoDownload: true,
    autoInstallOnAppQuit: true,
    logger: null,
    once: vi.fn(),
    off: vi.fn(),
  },
}))

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getAppPath: () => '/workspace/OpenWaggle',
    getVersion: () => '1.0.0-beta.25',
    requestSingleInstanceLock: () => true,
    releaseSingleInstanceLock: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
  },
}))
vi.mock('electron-updater', () => ({
  autoUpdater: Object.assign(updater, {
    checkForUpdates: checkForUpdatesMock,
    quitAndInstall: quitAndInstallMock,
  }),
}))
vi.mock('../session-host/local-session-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../session-host/local-session-client')>()),
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
vi.mock('../host-cli', () => ({ stopHostForUpdate: vi.fn() }))
vi.mock('../host-update-stop', () => ({ formatHostUpdateStopReport: () => 'Session Host report' }))

import { LocalSessionClientProtocolError } from '../session-host/local-session-client-protocol-error'
import { runUpdateCli } from '../update-cli'
import { writeUpdateCheckError } from '../update-cli-check-output'

describe('update CLI --check --json', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    checkForUpdatesMock.mockResolvedValue(null)
    configureUpdaterFeedMock.mockResolvedValue({ type: 'release', tag: 'v1.0.0-rc.1' })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  function savedChannel(channel: string) {
    executeLocalSessionCommandMock.mockResolvedValue({
      contract: 'local-update-v1',
      response: { contractVersion: 1, updateChannel: channel },
    })
  }

  function envelope(result: Readonly<Record<string, string>>) {
    return { schemaVersion: 1, type: 'response', command: 'update', result }
  }

  function printedResponse() {
    expect(writeCliStdoutMock).toHaveBeenCalledOnce()
    const parsed: unknown = JSON.parse(writeCliStdoutMock.mock.calls[0]?.[0] ?? '')
    return parsed
  }

  /** The Session Host was asked only to read the channel, never to save one. */
  function expectChannelOnlyRead() {
    expect(executeLocalSessionCommandMock).toHaveBeenCalledOnce()
    expect(executeLocalSessionCommandMock).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: {
          contract: 'local-update-v1',
          request: { contractVersion: 1, operation: 'get-channel' },
        },
      }),
    )
  }

  it('reports the saved channel and an available release without changing anything', async () => {
    savedChannel('beta')
    checkForUpdatesMock.mockResolvedValue({
      isUpdateAvailable: true,
      updateInfo: { version: '1.0.0-rc.1' },
    })

    await expect(runUpdateCli(['--check', '--json'])).resolves.toEqual({
      exitCode: 0,
      updaterOwnsExit: false,
    })

    expect(printedResponse()).toEqual(
      envelope({
        savedChannel: 'beta',
        channel: 'beta',
        status: 'available',
        version: '1.0.0-rc.1',
      }),
    )
    expectChannelOnlyRead()
    expect(updater.autoDownload).toBe(false)
    expect(quitAndInstallMock).not.toHaveBeenCalled()
  })

  it('reports the saved channel when it is up to date', async () => {
    savedChannel('alpha')

    await runUpdateCli(['--check', '--json'])

    expect(printedResponse()).toEqual(
      envelope({
        savedChannel: 'alpha',
        channel: 'alpha',
        status: 'up-to-date',
      }),
    )
  })

  it('reports the saved channel when its channel has no release yet', async () => {
    savedChannel('stable')
    configureUpdaterFeedMock.mockResolvedValue({ type: 'no-release' })

    await runUpdateCli(['--check', '--json'])

    expect(printedResponse()).toEqual(
      envelope({
        savedChannel: 'stable',
        channel: 'stable',
        status: 'no-release',
      }),
    )
  })

  it('reads, but never saves, the channel while it checks another one', async () => {
    savedChannel('beta')

    await runUpdateCli(['--channel', 'alpha', '--check', '--json'])

    expect(printedResponse()).toEqual(
      envelope({
        savedChannel: 'beta',
        channel: 'alpha',
        status: 'up-to-date',
      }),
    )
    expectChannelOnlyRead()
  })

  it('reports an exact version with the saved channel', async () => {
    savedChannel('beta')
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          new Response(JSON.stringify({ tag_name: 'v1.0.0-rc.1', assets: [] }), { status: 200 }),
        ),
      ),
    )

    await runUpdateCli(['--version', '1.0.0-rc.1', '--check', '--json'])

    expect(printedResponse()).toEqual(
      envelope({
        savedChannel: 'beta',
        status: 'available',
        version: '1.0.0-rc.1',
      }),
    )
    expectChannelOnlyRead()
  })

  it.each([
    ['a failed release check', ['--check', '--json']],
    ['a failed check of another channel', ['--channel', 'alpha', '--check', '--json']],
  ])('keeps the saved channel in the error envelope after %s', async (_label, args) => {
    const stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true)
    savedChannel('beta')
    checkForUpdatesMock.mockRejectedValueOnce(new Error('feed unavailable'))

    await expect(runUpdateCli(args)).resolves.toEqual({ exitCode: 1, updaterOwnsExit: false })

    expect(writeCliStdoutMock).not.toHaveBeenCalled()
    expect(JSON.parse(String(stderr.mock.calls[0]?.[0]))).toEqual({
      schemaVersion: 1,
      type: 'error',
      error: { kind: 'internal', message: 'feed unavailable' },
      savedChannel: 'beta',
    })
    expectChannelOnlyRead()
  })

  it('gives up on a stalled release check in time to report the saved channel', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true)
    savedChannel('alpha')
    checkForUpdatesMock.mockReturnValue(new Promise(() => undefined))

    const result = runUpdateCli(['--check', '--json'])
    await vi.advanceTimersByTimeAsync(30_000)

    await expect(result).resolves.toEqual({ exitCode: 7, updaterOwnsExit: false })
    expect(JSON.parse(String(stderr.mock.calls[0]?.[0]))).toEqual({
      schemaVersion: 1,
      type: 'error',
      error: { kind: 'timeout', message: 'The release check did not finish within 30 seconds.' },
      savedChannel: 'alpha',
    })
  })

  it('reports no channel when the Session Host cannot read it', async () => {
    const stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true)
    executeLocalSessionCommandMock.mockRejectedValue(new Error('Session Host unavailable'))

    await expect(runUpdateCli(['--check', '--json'])).resolves.toEqual({
      exitCode: 1,
      updaterOwnsExit: false,
    })

    expect(checkForUpdatesMock).not.toHaveBeenCalled()
    expect(JSON.parse(String(stderr.mock.calls[0]?.[0]))).toEqual({
      schemaVersion: 1,
      type: 'error',
      error: { kind: 'internal', message: 'Session Host unavailable' },
    })
  })

  it('refuses --json without --check, before it contacts the Session Host', async () => {
    const stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true)

    await expect(runUpdateCli(['--json'])).resolves.toEqual({
      exitCode: 2,
      updaterOwnsExit: false,
    })

    expect(createClientMock).not.toHaveBeenCalled()
    expect(JSON.parse(String(stderr.mock.calls[0]?.[0]))).toEqual({
      schemaVersion: 1,
      type: 'error',
      error: { kind: 'usage', message: '--json works only with --check.' },
    })
  })

  it('carries the Session Host code of a refusal in the error envelope', () => {
    const lines: string[] = []
    writeUpdateCheckError(
      new LocalSessionClientProtocolError('capability_denied', 'Refused.'),
      'beta',
      (value) => lines.push(value),
    )

    expect(JSON.parse(lines[0] ?? '')).toMatchObject({
      error: { kind: 'authorization', code: 'capability_denied' },
      savedChannel: 'beta',
    })
  })
})

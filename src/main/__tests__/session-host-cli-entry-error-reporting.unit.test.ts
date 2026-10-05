import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const order: string[] = []
  return {
    order,
    exit: vi.fn((_code: number) => void order.push('exit')),
    initializeRuntime: vi.fn(async () => undefined),
    initializeSettings: vi.fn(async () => void order.push('initialize-settings')),
    startErrorReporting: vi.fn(async (_process: string) => void order.push('start-reporting')),
    reportError: vi.fn((_error: unknown) => void order.push('report-error')),
    flushErrorReporting: vi.fn(async () => void order.push('flush-reports')),
    startHost: vi.fn(async () => ({
      liveness: { ownerCount: () => 1, hasAcceptedClient: () => true },
      stop: vi.fn(async () => undefined),
      waitUntilStopped: vi.fn(async () => undefined),
    })),
  }
})

vi.mock('electron', () => ({
  app: {
    exit: mocks.exit,
    getPath: vi.fn(() => '/tmp/openwaggle-profile'),
    getVersion: vi.fn(() => '1.0.0'),
    whenReady: vi.fn(async () => undefined),
    setActivationPolicy: vi.fn(),
  },
}))
vi.mock('node:fs', () => ({ existsSync: vi.fn(() => true) }))
vi.mock('../env', () => ({ env: {} }))
vi.mock('../error-reporting', () => ({
  startErrorReporting: mocks.startErrorReporting,
  reportError: mocks.reportError,
  flushErrorReporting: mocks.flushErrorReporting,
}))
vi.mock('../cli-output-flush', () => ({ flushCliOutput: vi.fn(async () => undefined) }))
vi.mock('../installer-update-channel-intent', () => ({
  applyInstallerUpdateChannelIntent: vi.fn(async () => null),
}))
vi.mock('../session-data', () => ({ configureAppStoragePaths: vi.fn() }))
vi.mock('../usage-statistics/usage-statistics-recorder')
vi.mock('../logger', () => {
  const silent = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
  return {
    SESSION_HOST_LOG_FILE_STEM: 'openwaggle-host',
    createLogger: () => silent,
    initFileLogger: vi.fn(async () => undefined),
    drainFileLogger: vi.fn(async () => undefined),
  }
})
vi.mock('../session-host/legacy-session-writer-fence', () => ({
  withLegacySessionWriterFence: (operation: () => Promise<unknown>) => operation(),
}))
vi.mock('../session-host/local-session-paths', () => ({
  prepareLocalSessionHostPaths: vi.fn(async (paths: object) => paths),
  rotateLocalSessionHostEndpoint: vi.fn(async (paths: object) => paths),
  resolveLocalSessionHostPaths: vi.fn(() => ({
    legacyDatabasePath: '/tmp/openwaggle-profile/legacy.sqlite',
    databasePath: '/tmp/openwaggle-profile/session-host.sqlite',
    recoveryDatabasePath: '/tmp/openwaggle-profile/recovery.sqlite',
    endpoint: '/tmp/openwaggle-profile/session-host.sock',
    endpointDirectory: null,
  })),
}))
vi.mock('../session-host/session-host-cutover', () => ({
  sessionHostTargetExists: vi.fn(async () => true),
  sessionHostSourceExists: vi.fn(async () => false),
  runSessionHostCutover: vi.fn(async () => undefined),
}))
vi.mock('../session-host/session-host-ownership', () => ({
  acquireSessionHostOwnership: vi.fn(async () => ({ release: vi.fn(async () => undefined) })),
}))
vi.mock('../session-host/session-host-bootstrap', () => ({ startAppSessionHost: mocks.startHost }))
vi.mock('../runtime', () => ({
  initializeAppRuntime: mocks.initializeRuntime,
  disposeAppRuntime: vi.fn(async () => undefined),
  runAppEffect: vi.fn(),
  startSessionHostOwnedServices: vi.fn(),
  stopSessionHostOwnedServices: vi.fn(),
}))
vi.mock('../store/settings', () => ({ initializeSettingsStore: mocks.initializeSettings }))

import { startSessionHostCliIfRequested } from '../session-host-cli-entry'

describe('Session Host error reporting', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.order.length = 0
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
  })

  it('starts reporting once Settings load and flushes reports before a clean exit', async () => {
    expect(startSessionHostCliIfRequested(['session-host-internal'])).toBe(true)
    await vi.waitFor(() => expect(mocks.exit).toHaveBeenCalledWith(0))

    expect(mocks.startErrorReporting).toHaveBeenCalledWith('session-host')
    expect(mocks.reportError).not.toHaveBeenCalled()
    expect(mocks.order).toEqual(['initialize-settings', 'start-reporting', 'flush-reports', 'exit'])
  })

  it('reports an unrecoverable error and flushes it before exiting', async () => {
    const failure = new Error('migration failed')
    mocks.initializeRuntime.mockRejectedValueOnce(failure)

    expect(startSessionHostCliIfRequested(['session-host-internal'])).toBe(true)
    await vi.waitFor(() => expect(mocks.exit).toHaveBeenCalledWith(1))

    expect(mocks.startErrorReporting).not.toHaveBeenCalled()
    expect(mocks.reportError).toHaveBeenCalledWith(failure)
    expect(mocks.order).toEqual(['report-error', 'flush-reports', 'exit'])
  })
})

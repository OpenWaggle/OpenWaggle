import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SessionHostLiveness } from '../application/session-host-liveness'

interface TestHost {
  readonly liveness: Pick<SessionHostLiveness, 'ownerCount' | 'hasAcceptedClient'>
  readonly stop: () => Promise<void>
  readonly waitUntilStopped: () => Promise<void>
}

const mocks = vi.hoisted(() => {
  const order: string[] = []
  return {
    order,
    exit: vi.fn(),
    endpointExists: vi.fn(() => true),
    releaseOwnership: vi.fn(async () => {
      order.push('release-ownership')
    }),
    initializeRuntime: vi.fn(async () => {
      order.push('initialize-runtime')
    }),
    disposeRuntime: vi.fn(async () => {
      order.push('dispose-runtime')
    }),
    initializeSettings: vi.fn(async () => {
      order.push('initialize-settings')
    }),
    applyInstallerIntent: vi.fn(async () => null),
    installShellEnvironment: vi.fn((_options?: { readonly cacheFile?: string }) => ({
      ready: Promise.resolve(),
      refreshed: Promise.resolve(),
      fromCache: false,
    })),
    disableHardwareAcceleration: vi.fn(),
    installSessionBus: vi.fn(() => void order.push('session-bus')),
    refreshedSince: vi.fn((): number | undefined => undefined),
    whenReady: vi.fn(async () => void order.push('when-ready')),
    initFileLogger: vi.fn(async () => void order.push('init-logger')),
    drainFileLogger: vi.fn(async () => void order.push('drain-logger')),
    hostLogError: vi.fn(),
    legacyFence: vi.fn((operation: () => Promise<unknown>) => operation()),
    sourceExists: vi.fn(async () => false),
    startHost: vi.fn<() => Promise<TestHost>>(async () => {
      order.push('start-host')
      return {
        liveness: { ownerCount: () => 1, hasAcceptedClient: () => true },
        stop: vi.fn(async () => undefined),
        waitUntilStopped: vi.fn(async () => {
          order.push('host-stopped')
        }),
      }
    }),
  }
})

vi.mock('electron', () => ({
  app: {
    exit: mocks.exit,
    getPath: vi.fn(() => '/tmp/openwaggle-profile'),
    getVersion: vi.fn(() => '1.0.0'),
    whenReady: mocks.whenReady,
    setActivationPolicy: vi.fn(),
    disableHardwareAcceleration: mocks.disableHardwareAcceleration,
    on: vi.fn(),
    off: vi.fn(),
  },
}))

vi.mock('node:fs', () => ({ existsSync: mocks.endpointExists }))

vi.mock('../env', () => ({
  env: {},
  logLevel: 'error',
  installDesktopShellEnvironment: (options?: { readonly cacheFile?: string }) =>
    mocks.installShellEnvironment(options),
  installLinuxSessionBusEnvironment: () => mocks.installSessionBus(),
  takeShellEnvironmentRefreshedSince: () => mocks.refreshedSince(),
}))
vi.mock('../installer-update-channel-intent', () => ({
  applyInstallerUpdateChannelIntent: mocks.applyInstallerIntent,
}))
vi.mock('../session-data', () => ({ configureAppStoragePaths: vi.fn() }))
vi.mock('../usage-statistics/usage-statistics-recorder')
vi.mock('../logger', async (importOriginal) => {
  const original = await importOriginal<typeof import('../logger')>()
  const createLogger = (name: string) =>
    name === 'session-host-cli'
      ? { ...original.createLogger(name), error: mocks.hostLogError }
      : original.createLogger(name)
  const { initFileLogger, drainFileLogger } = mocks
  return { ...original, initFileLogger, drainFileLogger, createLogger }
})
vi.mock('../session-host/legacy-session-writer-fence', () => ({
  withLegacySessionWriterFence: mocks.legacyFence,
}))
vi.mock('../session-host/local-session-paths', () => ({
  prepareLocalSessionHostPaths: vi.fn(async (paths: object) => paths),
  rotateLocalSessionHostEndpoint: vi.fn(async (paths: object) => paths),
  resolveLocalSessionHostPaths: vi.fn(() => ({
    stateRoot: '/tmp/openwaggle-profile/session-host',
    legacyDatabasePath: '/tmp/openwaggle-profile/legacy.sqlite',
    databasePath: '/tmp/openwaggle-profile/session-host.sqlite',
    recoveryDatabasePath: '/tmp/openwaggle-profile/recovery.sqlite',
    credentialPath: '/tmp/openwaggle-profile/credential',
    endpoint: '/tmp/openwaggle-profile/session-host.sock',
    endpointDirectory: '/tmp/openwaggle-profile',
    endpointCapabilityPath: null,
  })),
}))
vi.mock('../session-host/session-host-cutover', () => ({
  sessionHostTargetExists: vi.fn(async () => {
    mocks.order.push('inspect-database')
    return true
  }),
  sessionHostSourceExists: mocks.sourceExists,
  runSessionHostCutover: vi.fn(async () => {
    mocks.order.push('prepare-database')
  }),
}))
vi.mock('../session-host/session-host-ownership', () => ({
  acquireSessionHostOwnership: vi.fn(async () => {
    mocks.order.push('acquire-ownership')
    return {
      targetPath: '/tmp/openwaggle-profile/session-host.sqlite',
      release: mocks.releaseOwnership,
    }
  }),
}))
vi.mock('../session-host/session-host-bootstrap', () => ({ startAppSessionHost: mocks.startHost }))
vi.mock('../runtime', () => ({
  initializeAppRuntime: mocks.initializeRuntime,
  disposeAppRuntime: mocks.disposeRuntime,
  runAppEffect: vi.fn(),
  startSessionHostOwnedServices: vi.fn(),
  startSessionHostServicesAfterListening: vi.fn(),
  stopSessionHostOwnedServices: vi.fn(),
}))
vi.mock('../store/settings', () => ({
  initializeSettingsStore: mocks.initializeSettings,
}))

import { startSessionHostCliIfRequested } from '../session-host-cli-entry'

describe('detached Session Host shell environment and GPU', () => {
  afterEach(() => {
    vi.clearAllTimers()
    vi.useRealTimers()
  })

  beforeEach(() => {
    mocks.order.length = 0
    mocks.exit.mockClear()
    mocks.endpointExists.mockReturnValue(true)
    mocks.releaseOwnership.mockClear()
    mocks.initializeRuntime.mockClear()
    mocks.disposeRuntime.mockClear()
    mocks.initializeSettings.mockClear()
    mocks.applyInstallerIntent.mockClear()
    mocks.legacyFence.mockClear()
    mocks.sourceExists.mockReset().mockResolvedValue(false)
    mocks.startHost.mockClear()
    mocks.initFileLogger.mockClear()
  })

  it('listens before its login-shell probe settles, and reads it from the profile cache', async () => {
    const shell = Promise.withResolvers<void>()
    mocks.installShellEnvironment.mockImplementationOnce(() => {
      mocks.order.push('shell-environment-started')
      const refreshed = shell.promise.then(
        () => void mocks.order.push('shell-environment-refreshed'),
      )
      return { ready: refreshed, refreshed, fromCache: false }
    })

    expect(startSessionHostCliIfRequested(['session-host-internal'])).toBe(true)
    // The probe (zsh -ilc env, 0.1-5 s) does not hold the Host back from its clients.
    await vi.waitFor(() => expect(mocks.startHost).toHaveBeenCalledOnce())
    expect(mocks.order).not.toContain('shell-environment-refreshed')
    shell.resolve()
    await vi.waitFor(() => expect(mocks.exit).toHaveBeenCalledWith(0))

    const position = (step: string) => mocks.order.indexOf(step)
    // Started as soon as this Host owns the profile, before its runtime loads.
    expect(position('acquire-ownership')).toBeLessThan(position('shell-environment-started'))
    expect(position('shell-environment-started')).toBeLessThan(position('initialize-runtime'))
    expect(position('start-host')).toBeLessThan(position('shell-environment-refreshed'))
    // Only the desktop app writes the cache: this Host may have been started from a terminal.
    expect(mocks.installShellEnvironment).toHaveBeenCalledWith({
      cacheFile: '/tmp/openwaggle-profile/shell-environment.json',
      writeCache: false,
    })
  })

  it('waits for the refresh of the desktop app that launched it instead of a second login shell', async () => {
    mocks.refreshedSince.mockReturnValueOnce(1_800_000_000_000)

    expect(startSessionHostCliIfRequested(['session-host-internal'])).toBe(true)
    await vi.waitFor(() => expect(mocks.exit).toHaveBeenCalledWith(0))

    expect(mocks.installShellEnvironment).toHaveBeenLastCalledWith({
      cacheFile: '/tmp/openwaggle-profile/shell-environment.json',
      writeCache: false,
      refreshedElsewhereSince: 1_800_000_000_000,
    })
  })

  it('serves even when the login shell cannot be read', async () => {
    mocks.installShellEnvironment.mockImplementationOnce(() => {
      throw new Error('shell exited')
    })

    expect(startSessionHostCliIfRequested(['session-host-internal'])).toBe(true)
    await vi.waitFor(() => expect(mocks.exit).toHaveBeenCalledWith(0))

    expect(mocks.startHost).toHaveBeenCalledOnce()
  })

  it('skips the GPU process: the Host draws nothing (A-F13)', () => {
    mocks.disableHardwareAcceleration.mockClear()
    expect(startSessionHostCliIfRequested(['session-host-internal'])).toBe(true)

    expect(mocks.disableHardwareAcceleration).toHaveBeenCalledOnce()
  })

  it("fills the Linux session bus before Electron is ready, for Electron's secret store", () => {
    mocks.order.length = 0
    expect(startSessionHostCliIfRequested(['session-host-internal'])).toBe(true)

    expect(mocks.order.slice(0, 2)).toEqual(['session-bus', 'when-ready'])
  })
})

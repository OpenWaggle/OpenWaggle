import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SessionHostLiveness } from '../application/session-host-liveness'

interface TestHost {
  readonly liveness: Pick<SessionHostLiveness, 'ownerCount' | 'hasAcceptedClient'>
  readonly stop: () => Promise<void>
  readonly waitUntilStopped: () => Promise<void>
}

const mocks = vi.hoisted(() => {
  const order: string[] = []
  const quitHandlers = new Set<(event: { preventDefault(): void }) => void>()
  return {
    order,
    quitHandlers,
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
    whenReady: vi.fn(async () => undefined),
    setActivationPolicy: vi.fn(),
    on: (event: string, handler: (event: { preventDefault(): void }) => void) => {
      if (event === 'before-quit') mocks.quitHandlers.add(handler)
    },
    off: (event: string, handler: (event: { preventDefault(): void }) => void) => {
      if (event === 'before-quit') mocks.quitHandlers.delete(handler)
    },
  },
}))

vi.mock('node:fs', () => ({ existsSync: mocks.endpointExists }))

vi.mock('../env', () => ({ env: {} }))
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

describe('detached Session Host quit and orphan stop', () => {
  afterEach(() => {
    vi.clearAllTimers()
    vi.useRealTimers()
  })

  beforeEach(() => {
    mocks.order.length = 0
    mocks.exit.mockClear()
  })

  // Electron turns SIGTERM and SIGINT into an app quit; quitting at once would leave a stdio MCP
  // server that ignores SIGTERM running, since its SIGKILL is due 2 s later.
  it('stops the Host on SIGTERM, so its MCP servers are closed and killed before it exits', async () => {
    const stopped = Promise.withResolvers<void>()
    const stop = vi.fn(async () => {
      mocks.order.push('host-stop')
      stopped.resolve()
    })
    mocks.startHost.mockImplementationOnce(async () => {
      mocks.order.push('start-host')
      return {
        liveness: { ownerCount: () => 1, hasAcceptedClient: () => true },
        stop,
        waitUntilStopped: vi.fn(() => stopped.promise),
      }
    })

    expect(startSessionHostCliIfRequested(['session-host-internal'])).toBe(true)
    await vi.waitFor(() => expect(mocks.order).toContain('start-host'))
    const preventDefault = vi.fn()
    for (const handler of mocks.quitHandlers) handler({ preventDefault })

    await vi.waitFor(() => expect(mocks.exit).toHaveBeenCalledWith(0))
    expect(preventDefault).toHaveBeenCalled()
    expect(stop).toHaveBeenCalledOnce()
    // The runtime's disposal closes the MCP pool and kills groups still in their SIGTERM grace.
    expect(mocks.order.indexOf('dispose-runtime')).toBeGreaterThan(mocks.order.indexOf('host-stop'))
    expect(mocks.quitHandlers.size).toBe(0)
  })

  it('does not orphan-stop a never-adopted Host while it owns background work', async () => {
    vi.useFakeTimers()
    const stopped = Promise.withResolvers<void>()
    const stop = vi.fn(async () => stopped.resolve())
    const liveness = new SessionHostLiveness({
      idleGracePeriodMs: 300_000,
      requestShutdown: stop,
    })
    mocks.startHost.mockResolvedValueOnce({
      liveness,
      stop,
      waitUntilStopped: vi.fn(() => stopped.promise),
    })

    try {
      expect(startSessionHostCliIfRequested(['session-host-internal'])).toBe(true)
      await vi.advanceTimersByTimeAsync(0)
      const releaseWork = liveness.acquire('semantic-preparation')
      await vi.advanceTimersByTimeAsync(10_000)
      expect(stop).not.toHaveBeenCalled()
      expect(liveness.hasAcceptedClient()).toBe(false)
      releaseWork()
      await vi.advanceTimersByTimeAsync(299_999)
      expect(stop).not.toHaveBeenCalled()
      await vi.advanceTimersByTimeAsync(1)
      expect(stop).toHaveBeenCalledOnce()
      expect(mocks.exit).toHaveBeenCalledWith(0)
    } finally {
      liveness.close()
      stopped.resolve()
      await vi.advanceTimersByTimeAsync(0)
    }
  })
})

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SessionHostLiveness } from '../application/session-host-liveness'

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
    whenReady: vi.fn(async () => undefined),
  },
}))

vi.mock('../env', () => ({ env: {} }))
vi.mock('../session-data', () => ({ configureAppStoragePaths: vi.fn() }))
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
vi.mock('../session-host/session-host-bootstrap', () => ({
  startAppSessionHost: mocks.startHost,
}))
vi.mock('../runtime', () => ({
  initializeAppRuntime: mocks.initializeRuntime,
  disposeAppRuntime: mocks.disposeRuntime,
  runAppEffect: vi.fn(),
  startSessionHostOwnedServices: vi.fn(),
  stopSessionHostOwnedServices: vi.fn(),
}))
vi.mock('../store/settings', () => ({
  initializeSettingsStore: mocks.initializeSettings,
}))

import { startSessionHostCliIfRequested } from '../session-host-cli-entry'

describe('detached Session Host startup', () => {
  afterEach(() => {
    vi.clearAllTimers()
    vi.useRealTimers()
  })

  beforeEach(() => {
    mocks.order.length = 0
    mocks.exit.mockClear()
    mocks.releaseOwnership.mockClear()
    mocks.initializeRuntime.mockClear()
    mocks.disposeRuntime.mockClear()
    mocks.initializeSettings.mockClear()
    mocks.legacyFence.mockClear()
    mocks.sourceExists.mockReset().mockResolvedValue(false)
    mocks.startHost.mockClear()
  })

  it('owns the canonical store before inspecting it or initializing persistence', async () => {
    expect(startSessionHostCliIfRequested(['session-host-internal'])).toBe(true)

    await vi.waitFor(() => expect(mocks.exit).toHaveBeenCalledWith(0))

    expect(mocks.order).toEqual([
      'acquire-ownership',
      'inspect-database',
      'prepare-database',
      'initialize-runtime',
      'initialize-settings',
      'start-host',
      'host-stopped',
      'dispose-runtime',
      'release-ownership',
    ])
    expect(mocks.startHost).toHaveBeenCalledWith(
      expect.objectContaining({
        externalOwnership: expect.objectContaining({
          targetPath: '/tmp/openwaggle-profile/session-host.sqlite',
        }),
      }),
    )
  })

  it('disposes partial runtime initialization before releasing ownership', async () => {
    mocks.initializeRuntime.mockImplementationOnce(async () => {
      mocks.order.push('initialize-runtime')
      throw new Error('migration failed')
    })

    expect(startSessionHostCliIfRequested(['session-host-internal'])).toBe(true)
    await vi.waitFor(() => expect(mocks.exit).toHaveBeenCalledWith(1))

    expect(mocks.order).toEqual([
      'acquire-ownership',
      'inspect-database',
      'prepare-database',
      'initialize-runtime',
      'dispose-runtime',
      'release-ownership',
    ])
  })

  it('initializes a fresh profile without acquiring the legacy desktop writer fence', async () => {
    const cutover = await import('../session-host/session-host-cutover')
    vi.mocked(cutover.sessionHostTargetExists).mockResolvedValueOnce(false)

    expect(startSessionHostCliIfRequested(['session-host-internal'])).toBe(true)
    await vi.waitFor(() => expect(mocks.exit).toHaveBeenCalledWith(0))

    expect(mocks.sourceExists).toHaveBeenCalledOnce()
    expect(mocks.legacyFence).not.toHaveBeenCalled()
  })

  it('preserves an adopted Host across a restart at the orphan deadline until its configured idle grace expires', async () => {
    vi.useFakeTimers()
    const stopped = Promise.withResolvers<void>()
    const stop = vi.fn(async () => stopped.resolve())
    const liveness = new SessionHostLiveness({
      idleGracePeriodMs: 300_000,
      clientHandoffGracePeriodMs: 1_000,
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
      expect(mocks.startHost).toHaveBeenCalledOnce()
      const releaseCli = liveness.acquire('client')
      releaseCli()
      const releaseGui = liveness.acquire('client')
      await vi.advanceTimersByTimeAsync(9_500)
      releaseGui()

      await vi.advanceTimersByTimeAsync(500)
      expect(stop).not.toHaveBeenCalled()
      expect(mocks.exit).not.toHaveBeenCalled()
      await vi.advanceTimersByTimeAsync(299_499)
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

  it('still stops a never-adopted idle Host at the orphan deadline', async () => {
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
      await vi.advanceTimersByTimeAsync(9_999)
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

import { beforeEach, describe, expect, it, vi } from 'vitest'

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
    startHost: vi.fn(async () => {
      order.push('start-host')
      return {
        liveness: { ownerCount: () => 1 },
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
  withLegacySessionWriterFence: vi.fn((operation: () => Promise<unknown>) => operation()),
}))
vi.mock('../session-host/local-session-paths', () => ({
  prepareLocalSessionHostPaths: vi.fn(async () => undefined),
  resolveLocalSessionHostPaths: vi.fn(() => ({
    stateRoot: '/tmp/openwaggle-profile/session-host',
    legacyDatabasePath: '/tmp/openwaggle-profile/legacy.sqlite',
    databasePath: '/tmp/openwaggle-profile/session-host.sqlite',
    recoveryDatabasePath: '/tmp/openwaggle-profile/recovery.sqlite',
    credentialPath: '/tmp/openwaggle-profile/credential',
    endpoint: '/tmp/openwaggle-profile/session-host.sock',
    endpointDirectory: '/tmp/openwaggle-profile',
  })),
}))
vi.mock('../session-host/session-host-cutover', () => ({
  sessionHostTargetExists: vi.fn(async () => {
    mocks.order.push('inspect-database')
    return true
  }),
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
  beforeEach(() => {
    mocks.order.length = 0
    mocks.exit.mockClear()
    mocks.releaseOwnership.mockClear()
    mocks.initializeRuntime.mockClear()
    mocks.disposeRuntime.mockClear()
    mocks.initializeSettings.mockClear()
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
})

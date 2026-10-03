import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const order: string[] = []
  const configured: unknown[] = []
  const step = (name: string) => async () => {
    order.push(name)
  }
  return {
    order,
    exit: vi.fn(),
    configured,
    initializeRuntime: vi.fn(step('initialize-runtime')),
    disposeRuntime: vi.fn(step('dispose-runtime')),
    initializeSettings: vi.fn(step('initialize-settings')),
    releaseOwnership: vi.fn(step('release-ownership')),
    startHost: vi.fn(async () => {
      order.push('start-host')
      return {
        liveness: { ownerCount: () => 1, hasAcceptedClient: () => true },
        stop: async () => undefined,
        waitUntilStopped: step('host-stopped'),
      }
    }),
  }
})

vi.mock('electron', () => ({
  app: {
    exit: mocks.exit,
    getPath: () => '/tmp/openwaggle-profile',
    getVersion: () => '1.2.0',
    whenReady: async () => undefined,
    setActivationPolicy: () => undefined,
  },
}))
vi.mock('node:fs', () => ({ existsSync: () => true }))
vi.mock('../env', () => ({ env: {} }))
vi.mock('../installer-update-channel-intent', () => ({
  applyInstallerUpdateChannelIntent: async () => null,
}))
vi.mock('../session-data', () => ({ configureAppStoragePaths: () => undefined }))
vi.mock('../usage-statistics/usage-statistics-recorder', () => ({
  configureUsageStatisticsHostRecorder: (input: unknown) => {
    mocks.order.push('configure-usage-statistics')
    mocks.configured.push(input)
  },
  flushUsageStatistics: async () => {
    mocks.order.push('flush-usage-statistics')
  },
}))
vi.mock('../logger', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../logger')>()),
  initFileLogger: async () => undefined,
  drainFileLogger: async () => undefined,
}))
vi.mock('../session-host/legacy-session-writer-fence', () => ({
  withLegacySessionWriterFence: (operation: () => Promise<unknown>) => operation(),
}))
vi.mock('../session-host/local-session-paths', () => ({
  prepareLocalSessionHostPaths: async (paths: object) => paths,
  rotateLocalSessionHostEndpoint: async (paths: object) => paths,
  resolveLocalSessionHostPaths: () => ({
    stateRoot: '/tmp/openwaggle-profile/session-host',
    legacyDatabasePath: '/tmp/openwaggle-profile/legacy.sqlite',
    databasePath: '/tmp/openwaggle-profile/session-host.sqlite',
    recoveryDatabasePath: '/tmp/openwaggle-profile/recovery.sqlite',
    credentialPath: '/tmp/openwaggle-profile/credential',
    endpoint: '/tmp/openwaggle-profile/session-host.sock',
    endpointDirectory: '/tmp/openwaggle-profile',
    endpointCapabilityPath: null,
  }),
}))
vi.mock('../session-host/session-host-cutover', () => ({
  sessionHostTargetExists: async () => true,
  sessionHostSourceExists: async () => false,
  runSessionHostCutover: async () => undefined,
}))
vi.mock('../session-host/session-host-ownership', () => ({
  acquireSessionHostOwnership: async () => ({
    targetPath: '/tmp/openwaggle-profile/session-host.sqlite',
    release: mocks.releaseOwnership,
  }),
}))
vi.mock('../session-host/session-host-bootstrap', () => ({ startAppSessionHost: mocks.startHost }))
vi.mock('../runtime', () => ({
  initializeAppRuntime: mocks.initializeRuntime,
  disposeAppRuntime: mocks.disposeRuntime,
  runAppEffect: () => undefined,
  startSessionHostOwnedServices: () => undefined,
  stopSessionHostOwnedServices: () => undefined,
}))
vi.mock('../store/settings', () => ({ initializeSettingsStore: mocks.initializeSettings }))

import { startSessionHostCliIfRequested } from '../session-host-cli-entry'

describe('detached Session Host Usage statistics lifecycle', () => {
  beforeEach(() => {
    mocks.order.length = 0
    mocks.configured.length = 0
    mocks.exit.mockClear()
  })

  it('starts recording after Settings load and saves it before the Host gives up its store', async () => {
    expect(startSessionHostCliIfRequested(['session-host-internal'])).toBe(true)
    await vi.waitFor(() => expect(mocks.exit).toHaveBeenCalledWith(0))

    expect(mocks.order).toEqual([
      'initialize-runtime',
      'initialize-settings',
      // Enablement needs the loaded Setting, and every Run the Host starts needs the recorder.
      'configure-usage-statistics',
      'start-host',
      'host-stopped',
      // Saved while this process still owns the profile.
      'flush-usage-statistics',
      'dispose-runtime',
      'release-ownership',
    ])
    expect(mocks.configured).toEqual([
      { userDataDirectory: '/tmp/openwaggle-profile', appVersion: '1.2.0' },
    ])
  })
})

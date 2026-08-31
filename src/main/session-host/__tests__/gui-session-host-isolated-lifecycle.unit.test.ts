import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  acquire: vi.fn(),
  configureClient: vi.fn(),
  ensure: vi.fn(async () => undefined),
  preparePaths: vi.fn(async () => undefined),
  probe: vi.fn(),
  remoteBridge: vi.fn(() => vi.fn()),
  startHost: vi.fn(),
}))

vi.mock('../../application/local-session-command-dispatcher', () => ({
  configureGuiSessionCommandClient: mocks.configureClient,
  retireGuiSessionCommandClientForUpgrade: vi.fn(),
}))
vi.mock('../local-session-client', () => ({
  LocalSessionHostUpgradePendingError: class extends Error {},
  probeLocalSessionHost: mocks.probe,
}))
vi.mock('../local-session-host-launcher', () => ({
  HOST_TAKEOVER_TIMEOUT_MS: 900_000,
  ensureLocalSessionHost: mocks.ensure,
  isLocalSessionHostUnavailable: (error: unknown) =>
    typeof error === 'object' && error !== null && 'code' in error,
  waitForLocalSessionHostRelease: vi.fn(async () => false),
}))
vi.mock('../local-session-paths', () => ({
  prepareLocalSessionHostPaths: mocks.preparePaths,
  resolveLocalSessionHostPaths: () => ({
    endpoint: '/tmp/openwaggle.sock',
    legacyDatabasePath: '/tmp/legacy.db',
    databasePath: '/tmp/session-host.db',
    recoveryDatabasePath: '/tmp/recovery.db',
  }),
}))
vi.mock('../session-host-ownership', () => ({
  acquireSessionHostOwnership: mocks.acquire,
}))
vi.mock('../session-host-cutover', () => ({
  runSessionHostCutover: vi.fn(async () => undefined),
  sessionHostTargetExists: vi.fn(async () => true),
}))
vi.mock('../legacy-session-writer-fence', () => ({
  withLegacySessionWriterFence: (operation: () => Promise<unknown>) => operation(),
}))
vi.mock('../session-host-bootstrap', () => ({ startAppSessionHost: mocks.startHost }))
vi.mock('../session-host-renderer-bridge', () => ({
  startRemoteSessionHostRendererBridge: mocks.remoteBridge,
  startSessionHostRendererBridge: vi.fn(),
}))

import { prepareGuiSessionHostLifecycle } from '../gui-session-host-lifecycle'

describe('isolated GUI Session Host lifecycle', () => {
  beforeEach(() => {
    const unavailable = Object.assign(new Error('missing socket'), { code: 'ENOENT' })
    mocks.acquire.mockReset()
    mocks.ensure.mockReset().mockResolvedValue(undefined)
    mocks.probe
      .mockReset()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(unavailable)
      .mockResolvedValueOnce(undefined)
    mocks.remoteBridge.mockClear()
    mocks.startHost.mockReset()
  })

  it('launches a detached Host instead of promoting its isolated runtime to owner', async () => {
    const lifecycle = await prepareGuiSessionHostLifecycle({
      userDataRoot: '/tmp/openwaggle-test',
      clientVersion: 'test',
      startupMark: vi.fn(),
    })
    await expect(
      lifecycle.start({
        runEffect: vi.fn(),
        startOwnedServices: vi.fn(async () => undefined),
        stopOwnedServices: vi.fn(async () => undefined),
      }),
    ).resolves.toBe('attached')

    expect(lifecycle.databaseAccess).toBe('client-isolated')
    expect(mocks.ensure).toHaveBeenCalledOnce()
    expect(mocks.acquire).not.toHaveBeenCalled()
    expect(mocks.startHost).not.toHaveBeenCalled()
    await lifecycle.stop()
  })
})

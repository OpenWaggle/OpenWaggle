import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  releaseSessionHostForUpdateMock,
  configureGuiSessionCommandClientMock,
  ensureLocalSessionHostMock,
  prepareLocalSessionHostPathsMock,
  probeLocalSessionHostMock,
  startRemoteSessionHostRendererBridgeMock,
  stopRendererBridgeMock,
} = vi.hoisted(() => ({
  releaseSessionHostForUpdateMock: vi.fn(async () => 'stopped'),
  configureGuiSessionCommandClientMock: vi.fn(),
  ensureLocalSessionHostMock: vi.fn(async () => undefined),
  prepareLocalSessionHostPathsMock: vi.fn(async (paths: object) => paths),
  probeLocalSessionHostMock: vi.fn(async () => undefined),
  startRemoteSessionHostRendererBridgeMock: vi.fn(),
  stopRendererBridgeMock: vi.fn(),
}))

vi.mock('../../application/local-session-command-dispatcher', () => ({
  configureGuiSessionCommandClient: configureGuiSessionCommandClientMock,
}))
vi.mock('../local-session-client', () => ({
  LocalSessionHostUpgradePendingError: class extends Error {},
  probeLocalSessionHost: probeLocalSessionHostMock,
}))
vi.mock('../local-session-host-launcher', () => ({
  ensureLocalSessionHost: ensureLocalSessionHostMock,
  isLocalSessionHostUnavailable: (error: unknown) =>
    typeof error === 'object' && error !== null && 'code' in error,
  waitForLocalSessionHostRelease: vi.fn(async () => false),
}))
vi.mock('../local-session-paths', () => ({
  prepareLocalSessionHostPaths: prepareLocalSessionHostPathsMock,
  refreshLocalSessionHostEndpoint: vi.fn(async (paths: object) => paths),
  resolveLocalSessionHostPaths: () => ({
    endpoint: '/tmp/openwaggle.sock',
    legacyDatabasePath: '/tmp/legacy.db',
    databasePath: '/tmp/session-host.db',
    recoveryDatabasePath: '/tmp/recovery.db',
    endpointCapabilityPath: null,
  }),
}))
vi.mock('../session-host-cutover', () => ({
  runSessionHostCutover: vi.fn(async () => undefined),
  sessionHostTargetExists: vi.fn(async () => true),
}))
vi.mock('../legacy-session-writer-fence', () => ({
  withLegacySessionWriterFence: (operation: () => Promise<unknown>) => operation(),
}))
vi.mock('../gui-session-host-release', () => ({
  releaseSessionHostForUpdate: releaseSessionHostForUpdateMock,
}))
vi.mock('../session-host-renderer-bridge', () => ({
  startRemoteSessionHostRendererBridge: startRemoteSessionHostRendererBridgeMock,
}))

import { prepareGuiSessionHostLifecycle } from '../gui-session-host-lifecycle'
import {
  isGuiAttachedToRemoteSessionHost,
  setGuiAttachedToRemoteSessionHost,
} from '../gui-session-host-state'

describe('GUI Session Host lifecycle', () => {
  beforeEach(() => {
    setGuiAttachedToRemoteSessionHost(false)
    configureGuiSessionCommandClientMock.mockReset()
    ensureLocalSessionHostMock.mockReset().mockResolvedValue(undefined)
    prepareLocalSessionHostPathsMock.mockClear()
    probeLocalSessionHostMock.mockReset().mockResolvedValue(undefined)
    startRemoteSessionHostRendererBridgeMock.mockReset().mockReturnValue(stopRendererBridgeMock)
    stopRendererBridgeMock.mockReset()
    releaseSessionHostForUpdateMock.mockClear()
  })

  it('leaves the detached Host running on a normal quit', async () => {
    const lifecycle = await prepareGuiSessionHostLifecycle({
      userDataRoot: '/tmp/openwaggle-test',
      clientVersion: 'test',
      startupMark: vi.fn(),
    })
    await lifecycle.start()

    await lifecycle.stop()

    expect(releaseSessionHostForUpdateMock).not.toHaveBeenCalled()
  })

  it('stops the detached Host only after detaching from it when an update installs', async () => {
    const lifecycle = await prepareGuiSessionHostLifecycle({
      userDataRoot: '/tmp/openwaggle-test',
      clientVersion: 'test',
      startupMark: vi.fn(),
    })
    await lifecycle.start()
    releaseSessionHostForUpdateMock.mockImplementationOnce(async () => {
      // Nothing in the app may route to, or restart, the Host while it stops.
      expect(stopRendererBridgeMock).toHaveBeenCalledOnce()
      expect(configureGuiSessionCommandClientMock).toHaveBeenLastCalledWith(null)
      expect(isGuiAttachedToRemoteSessionHost()).toBe(false)
      return 'stopped'
    })

    await lifecycle.stop({ releaseHostForUpdate: true })

    expect(releaseSessionHostForUpdateMock).toHaveBeenCalledOnce()
    expect(releaseSessionHostForUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({ clientVersion: 'test' }),
    )
  })

  it('attaches to an existing detached Host and awaits bridge shutdown before detaching', async () => {
    const lifecycle = await prepareGuiSessionHostLifecycle({
      userDataRoot: '/tmp/openwaggle-test',
      clientVersion: 'test',
      startupMark: vi.fn(),
    })

    await expect(lifecycle.start()).resolves.toBeUndefined()
    expect(ensureLocalSessionHostMock).not.toHaveBeenCalled()
    expect(isGuiAttachedToRemoteSessionHost()).toBe(true)

    const bridgeStopped = Promise.withResolvers<void>()
    stopRendererBridgeMock.mockReturnValueOnce(bridgeStopped.promise)
    const stop = lifecycle.stop()
    await Promise.resolve()
    expect(isGuiAttachedToRemoteSessionHost()).toBe(true)
    bridgeStopped.resolve()
    await stop

    expect(stopRendererBridgeMock).toHaveBeenCalledOnce()
    expect(isGuiAttachedToRemoteSessionHost()).toBe(false)
  })

  it('launches a detached Host when none exists and never promotes the GUI to owner', async () => {
    const unavailable = Object.assign(new Error('missing socket'), { code: 'ENOENT' })
    probeLocalSessionHostMock.mockRejectedValueOnce(unavailable).mockResolvedValue(undefined)
    const lifecycle = await prepareGuiSessionHostLifecycle({
      userDataRoot: '/tmp/openwaggle-test',
      clientVersion: 'test',
      startupMark: vi.fn(),
    })

    await expect(lifecycle.start()).resolves.toBeUndefined()

    expect(ensureLocalSessionHostMock).toHaveBeenCalledOnce()
    await lifecycle.stop()
  })
})

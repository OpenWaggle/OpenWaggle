import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  configureGuiSessionCommandClientMock,
  retireGuiSessionCommandClientForUpgradeMock,
  prepareLocalSessionHostPathsMock,
  probeLocalSessionHostMock,
  runSessionHostCutoverMock,
  sessionHostTargetExistsMock,
  startAppSessionHostMock,
  startRemoteSessionHostRendererBridgeMock,
  startSessionHostRendererBridgeMock,
  stopRendererBridgeMock,
  withLegacySessionWriterFenceMock,
} = vi.hoisted(() => ({
  configureGuiSessionCommandClientMock: vi.fn(),
  retireGuiSessionCommandClientForUpgradeMock: vi.fn(),
  prepareLocalSessionHostPathsMock: vi.fn(async () => undefined),
  probeLocalSessionHostMock: vi.fn(async () => undefined),
  runSessionHostCutoverMock: vi.fn(async () => undefined),
  sessionHostTargetExistsMock: vi.fn(async () => true),
  startAppSessionHostMock: vi.fn(),
  startRemoteSessionHostRendererBridgeMock: vi.fn(),
  startSessionHostRendererBridgeMock: vi.fn(),
  stopRendererBridgeMock: vi.fn(),
  withLegacySessionWriterFenceMock: vi.fn((operation: () => Promise<unknown>) => operation()),
}))

vi.mock('../../application/local-session-command-dispatcher', () => ({
  configureGuiSessionCommandClient: configureGuiSessionCommandClientMock,
  retireGuiSessionCommandClientForUpgrade: retireGuiSessionCommandClientForUpgradeMock,
}))

vi.mock('../local-session-client', () => ({
  LocalSessionHostUpgradePendingError: class extends Error {},
  probeLocalSessionHost: probeLocalSessionHostMock,
}))

vi.mock('../legacy-session-writer-fence', () => ({
  withLegacySessionWriterFence: withLegacySessionWriterFenceMock,
}))

vi.mock('../local-session-host-launcher', () => ({
  isLocalSessionHostUnavailable: (error: unknown) =>
    typeof error === 'object' && error !== null && 'code' in error,
  waitForLocalSessionHostRelease: vi.fn(async () => false),
}))

vi.mock('../local-session-paths', () => ({
  prepareLocalSessionHostPaths: prepareLocalSessionHostPathsMock,
  resolveLocalSessionHostPaths: () => ({
    endpoint: '/tmp/openwaggle.sock',
    legacyDatabasePath: '/tmp/legacy.db',
    databasePath: '/tmp/session-host.db',
    recoveryDatabasePath: '/tmp/recovery.db',
  }),
}))

vi.mock('../session-host-bootstrap', () => ({
  startAppSessionHost: startAppSessionHostMock,
}))

vi.mock('../session-host-cutover', () => ({
  runSessionHostCutover: runSessionHostCutoverMock,
  sessionHostTargetExists: sessionHostTargetExistsMock,
}))

vi.mock('../session-host-renderer-bridge', () => ({
  startRemoteSessionHostRendererBridge: startRemoteSessionHostRendererBridgeMock,
  startSessionHostRendererBridge: startSessionHostRendererBridgeMock,
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
    retireGuiSessionCommandClientForUpgradeMock.mockReset()
    probeLocalSessionHostMock.mockReset().mockResolvedValue(undefined)
    startRemoteSessionHostRendererBridgeMock.mockReset().mockReturnValue(stopRendererBridgeMock)
    startSessionHostRendererBridgeMock.mockReset().mockReturnValue(stopRendererBridgeMock)
    startAppSessionHostMock.mockReset()
    sessionHostTargetExistsMock.mockReset().mockResolvedValue(true)
    stopRendererBridgeMock.mockReset()
    withLegacySessionWriterFenceMock.mockClear()
  })

  it('takes the legacy desktop writer fence only when the target store is absent', async () => {
    sessionHostTargetExistsMock.mockResolvedValue(false)

    await prepareGuiSessionHostLifecycle({
      userDataRoot: '/tmp/openwaggle-test',
      clientVersion: 'test',
      startupMark: vi.fn(),
    })

    expect(withLegacySessionWriterFenceMock).toHaveBeenCalledOnce()
    expect(runSessionHostCutoverMock).toHaveBeenCalledOnce()
  })

  it('publishes remote attachment state for IPC ownership guards and clears it on stop', async () => {
    const lifecycle = await prepareGuiSessionHostLifecycle({
      userDataRoot: '/tmp/openwaggle-test',
      clientVersion: 'test',
      startupMark: vi.fn(),
    })

    await expect(
      lifecycle.start({
        runEffect: async () => {
          throw new Error('The remote attachment path must not run local effects.')
        },
        startOwnedServices: vi.fn(async () => undefined),
        stopOwnedServices: vi.fn(async () => undefined),
      }),
    ).resolves.toBe('attached')
    expect(isGuiAttachedToRemoteSessionHost()).toBe(true)

    await lifecycle.stop()

    expect(stopRendererBridgeMock).toHaveBeenCalledOnce()
    expect(isGuiAttachedToRemoteSessionHost()).toBe(false)
  })

  it('restarts a GUI-owned Host after supervised Run failure drains its runtime', async () => {
    const unavailable = Object.assign(new Error('missing socket'), { code: 'ENOENT' })
    probeLocalSessionHostMock.mockRejectedValue(unavailable)
    let stopFirst: (() => void) | undefined
    const firstStopped = new Promise<void>((resolve) => {
      stopFirst = resolve
    })
    let stopSecond: (() => void) | undefined
    const secondStopped = new Promise<void>((resolve) => {
      stopSecond = resolve
    })
    const firstRuntime = {
      liveness: { drainReason: () => 'recovery' as const },
      isStopping: () => false,
      waitUntilStopped: () => firstStopped,
      stop: vi.fn(async () => stopFirst?.()),
    }
    const secondRuntime = {
      liveness: { drainReason: () => 'recovery' as const },
      isStopping: () => false,
      waitUntilStopped: () => secondStopped,
      stop: vi.fn(async () => stopSecond?.()),
    }
    startAppSessionHostMock
      .mockImplementationOnce(async (hostInput) => {
        await hostInput.startOwnedServices()
        return firstRuntime
      })
      .mockImplementationOnce(async (hostInput) => {
        await hostInput.startOwnedServices()
        return secondRuntime
      })
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
    ).resolves.toBe('owned')
    stopFirst?.()
    await vi.waitFor(() => expect(startAppSessionHostMock).toHaveBeenCalledTimes(2))

    expect(startSessionHostRendererBridgeMock).toHaveBeenCalledTimes(2)
    expect(isGuiAttachedToRemoteSessionHost()).toBe(false)
    await lifecycle.stop()
    expect(secondRuntime.stop).toHaveBeenCalledOnce()
    expect(startAppSessionHostMock).toHaveBeenCalledTimes(2)
  })

  it('stops owned background services when another Host wins recovery ownership', async () => {
    const unavailable = Object.assign(new Error('missing socket'), { code: 'ENOENT' })
    probeLocalSessionHostMock.mockRejectedValueOnce(unavailable).mockResolvedValueOnce(undefined)
    let markStopped: (() => void) | undefined
    const stopped = new Promise<void>((resolve) => {
      markStopped = resolve
    })
    const runtime = {
      liveness: { drainReason: () => 'recovery' as const },
      isStopping: () => false,
      waitUntilStopped: () => stopped,
      stop: vi.fn(async () => markStopped?.()),
    }
    startAppSessionHostMock
      .mockImplementationOnce(async (hostInput) => {
        await hostInput.startOwnedServices()
        return runtime
      })
      .mockRejectedValueOnce(new Error('another Host acquired the endpoint'))
    const stopOwnedServices = vi.fn(async () => undefined)
    const lifecycle = await prepareGuiSessionHostLifecycle({
      userDataRoot: '/tmp/openwaggle-test',
      clientVersion: 'test',
      startupMark: vi.fn(),
    })

    await lifecycle.start({
      runEffect: vi.fn(),
      startOwnedServices: vi.fn(async () => undefined),
      stopOwnedServices,
    })
    markStopped?.()
    await vi.waitFor(() => expect(stopOwnedServices).toHaveBeenCalledOnce())

    expect(startRemoteSessionHostRendererBridgeMock).toHaveBeenCalledOnce()
    expect(isGuiAttachedToRemoteSessionHost()).toBe(true)
    await lifecycle.stop()
    expect(stopOwnedServices).toHaveBeenCalledOnce()
  })

  it('does not restart a GUI-owned Host that retired for an upgrade handoff', async () => {
    const unavailable = Object.assign(new Error('missing socket'), { code: 'ENOENT' })
    probeLocalSessionHostMock.mockRejectedValue(unavailable)
    let markStopped: (() => void) | undefined
    const stopped = new Promise<void>((resolve) => {
      markStopped = resolve
    })
    const runtime = {
      liveness: { drainReason: () => 'upgrade' as const },
      isStopping: () => false,
      waitUntilStopped: () => stopped,
      stop: vi.fn(async () => markStopped?.()),
    }
    startAppSessionHostMock.mockImplementation(async (hostInput) => {
      await hostInput.startOwnedServices()
      return runtime
    })
    const lifecycle = await prepareGuiSessionHostLifecycle({
      userDataRoot: '/tmp/openwaggle-test',
      clientVersion: 'test',
      startupMark: vi.fn(),
    })

    const stopOwnedServices = vi.fn(async () => undefined)
    await lifecycle.start({
      runEffect: vi.fn(),
      startOwnedServices: vi.fn(async () => undefined),
      stopOwnedServices,
    })
    markStopped?.()
    await vi.waitFor(() => expect(stopOwnedServices).toHaveBeenCalledOnce())

    expect(startAppSessionHostMock).toHaveBeenCalledOnce()
    expect(retireGuiSessionCommandClientForUpgradeMock).toHaveBeenCalledOnce()
    expect(isGuiAttachedToRemoteSessionHost()).toBe(false)
    await lifecycle.stop()
  })

  it('does not reactivate writer services when the Host drains during startup', async () => {
    const unavailable = Object.assign(new Error('missing socket'), { code: 'ENOENT' })
    probeLocalSessionHostMock.mockRejectedValueOnce(unavailable).mockResolvedValueOnce(undefined)
    const runtime = {
      liveness: { drainReason: () => 'upgrade' as const },
      isStopping: () => true,
      waitUntilStopped: () => Promise.resolve(),
      stop: vi.fn(async () => undefined),
    }
    startAppSessionHostMock.mockImplementationOnce(async (hostInput) => {
      await hostInput.startOwnedServices()
      await hostInput.stopOwnedServices()
      return runtime
    })
    const startOwnedServices = vi.fn(async () => undefined)
    const stopOwnedServices = vi.fn(async () => undefined)
    const lifecycle = await prepareGuiSessionHostLifecycle({
      userDataRoot: '/tmp/openwaggle-test',
      clientVersion: 'test',
      startupMark: vi.fn(),
    })

    await expect(
      lifecycle.start({ runEffect: vi.fn(), startOwnedServices, stopOwnedServices }),
    ).resolves.toBe('attached')

    expect(startOwnedServices).toHaveBeenCalledOnce()
    expect(stopOwnedServices).toHaveBeenCalledOnce()
    expect(startRemoteSessionHostRendererBridgeMock).toHaveBeenCalledOnce()
    await lifecycle.stop()
    expect(startOwnedServices).toHaveBeenCalledOnce()
    expect(stopOwnedServices).toHaveBeenCalledOnce()
  })
})

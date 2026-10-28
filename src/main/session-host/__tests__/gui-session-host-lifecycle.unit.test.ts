import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  releaseSessionHostForUpdateMock,
  configureGuiSessionCommandClientMock,
  ensureLocalSessionHostMock,
  prepareLocalSessionHostPathsMock,
  probeLocalSessionHostMock,
  startRemoteSessionHostRendererBridgeMock,
  stopRendererBridgeMock,
  waitForLocalSessionHostReleaseMock,
  UpgradePendingError,
} = vi.hoisted(() => ({
  waitForLocalSessionHostReleaseMock: vi.fn(
    async (_endpoint: string, _options?: { readonly signal?: AbortSignal }) => false,
  ),
  UpgradePendingError: class extends Error {},
  releaseSessionHostForUpdateMock: vi.fn(async () => 'stopped'),
  configureGuiSessionCommandClientMock: vi.fn(),
  ensureLocalSessionHostMock: vi.fn(
    async (_input: { readonly onLaunched?: () => void }): Promise<void> => undefined,
  ),
  prepareLocalSessionHostPathsMock: vi.fn(async (paths: object) => paths),
  probeLocalSessionHostMock: vi.fn(async () => undefined),
  startRemoteSessionHostRendererBridgeMock: vi.fn(),
  stopRendererBridgeMock: vi.fn(),
}))

vi.mock('../../application/gui-session-command-router', () => ({
  configureGuiSessionCommandClient: configureGuiSessionCommandClientMock,
}))
vi.mock('../local-session-client', () => ({
  LocalSessionHostUpgradePendingError: UpgradePendingError,
  probeLocalSessionHost: probeLocalSessionHostMock,
}))
vi.mock('../local-session-host-launcher', () => ({
  ensureLocalSessionHost: ensureLocalSessionHostMock,
  isLocalSessionHostUnavailable: (error: unknown) =>
    typeof error === 'object' && error !== null && 'code' in error,
  waitForLocalSessionHostRelease: waitForLocalSessionHostReleaseMock,
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
vi.mock('../session-host-update-release', () => ({
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
    waitForLocalSessionHostReleaseMock.mockReset().mockResolvedValue(false)
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
    // As the desktop app, which the Host lets stop it only for an update.
    expect(releaseSessionHostForUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({ clientVersion: 'test', clientKind: 'gui' }),
    )
  })

  it('stops waiting for an updating Host to hand over once the start is aborted', async () => {
    probeLocalSessionHostMock.mockRejectedValue(new UpgradePendingError('updating'))
    waitForLocalSessionHostReleaseMock.mockImplementation(
      (_endpoint, options) =>
        new Promise((_resolve, reject) => {
          options?.signal?.addEventListener('abort', () => reject(options.signal?.reason))
        }),
    )
    const lifecycle = await prepareGuiSessionHostLifecycle({
      userDataRoot: '/tmp/openwaggle-test',
      clientVersion: 'test',
      startupMark: vi.fn(),
    })
    const controller = new AbortController()
    const start = lifecycle.start(controller.signal)
    const outcome = start.then(
      () => 'attached',
      () => 'stopped',
    )
    await vi.waitFor(() => expect(waitForLocalSessionHostReleaseMock).toHaveBeenCalled())

    controller.abort(new Error('Startup was retried.'))
    const pending = new Promise((resolve) => setTimeout(() => resolve('still waiting'), 50))
    expect(await Promise.race([outcome, pending])).toBe('stopped')
  })

  it('says when an updating Host has handed over, so the startup deadline applies again', async () => {
    probeLocalSessionHostMock.mockRejectedValueOnce(new UpgradePendingError('updating'))
    waitForLocalSessionHostReleaseMock.mockResolvedValueOnce(true)
    const order: string[] = []
    const lifecycle = await prepareGuiSessionHostLifecycle({
      userDataRoot: '/tmp/openwaggle-test',
      clientVersion: 'test',
      startupMark: vi.fn(),
      onUpgradePending: () => order.push('updating'),
      onUpgradeReleased: () => order.push('updated'),
    })

    await lifecycle.start()

    expect(order).toEqual(['updating', 'updated'])
    expect(isGuiAttachedToRemoteSessionHost()).toBe(true)
  })

  it('attaches once when started again while attached', async () => {
    const lifecycle = await prepareGuiSessionHostLifecycle({
      userDataRoot: '/tmp/openwaggle-test',
      clientVersion: 'test',
      startupMark: vi.fn(),
    })
    await lifecycle.start()
    await lifecycle.start()

    // A second bridge would forward every Host event twice, and the first would never stop.
    expect(startRemoteSessionHostRendererBridgeMock).toHaveBeenCalledOnce()
    await lifecycle.stop()
    expect(stopRendererBridgeMock).toHaveBeenCalledOnce()
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

  it('says the Host is underway when it attaches to a running one', async () => {
    const onHostUnderway = vi.fn()
    const lifecycle = await prepareGuiSessionHostLifecycle({
      userDataRoot: '/tmp/openwaggle-test',
      clientVersion: 'test',
      startupMark: vi.fn(),
      onHostUnderway,
    })

    await lifecycle.start()

    expect(onHostUnderway).toHaveBeenCalledOnce()
    await lifecycle.stop()
  })

  it('launches with the start signal and says the Host is underway once launched (A-F1)', async () => {
    const unavailable = Object.assign(new Error('missing socket'), { code: 'ENOENT' })
    probeLocalSessionHostMock.mockRejectedValueOnce(unavailable).mockResolvedValue(undefined)
    const onHostUnderway = vi.fn()
    const startupMark = vi.fn()
    ensureLocalSessionHostMock.mockImplementationOnce(
      async (input: { readonly onLaunched?: () => void }) => {
        input.onLaunched?.()
      },
    )
    const lifecycle = await prepareGuiSessionHostLifecycle({
      userDataRoot: '/tmp/openwaggle-test',
      clientVersion: 'test',
      startupMark,
      onHostUnderway,
    })
    const controller = new AbortController()

    await lifecycle.start(controller.signal)

    expect(ensureLocalSessionHostMock).toHaveBeenCalledWith(
      expect.objectContaining({ signal: controller.signal }),
    )
    expect(startupMark).toHaveBeenCalledWith('session-host-launched')
    expect(onHostUnderway).toHaveBeenCalled()
    await lifecycle.stop()
  })

  it('does not launch a Host for a start that was already aborted', async () => {
    const unavailable = Object.assign(new Error('missing socket'), { code: 'ENOENT' })
    probeLocalSessionHostMock.mockRejectedValue(unavailable)
    const lifecycle = await prepareGuiSessionHostLifecycle({
      userDataRoot: '/tmp/openwaggle-test',
      clientVersion: 'test',
      startupMark: vi.fn(),
    })
    const controller = new AbortController()
    controller.abort(new Error('retried'))

    await expect(lifecycle.start(controller.signal)).rejects.toThrow('retried')
    expect(ensureLocalSessionHostMock).not.toHaveBeenCalled()
  })
})

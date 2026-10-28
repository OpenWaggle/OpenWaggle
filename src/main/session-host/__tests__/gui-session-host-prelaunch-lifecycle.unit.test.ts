import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  configureClient: vi.fn(),
  cutover: vi.fn(async () => undefined),
  ensure: vi.fn(async () => undefined),
  preparePaths: vi.fn(async (paths: object) => paths),
  probe: vi.fn(),
  remoteBridge: vi.fn(() => vi.fn()),
  targetExists: vi.fn(async () => false),
}))

vi.mock('../../application/gui-session-command-router', () => ({
  configureGuiSessionCommandClient: mocks.configureClient,
}))
vi.mock('../local-session-client', () => ({
  LocalSessionHostUpgradePendingError: class extends Error {},
  probeLocalSessionHost: mocks.probe,
}))
vi.mock('../local-session-host-launcher', () => ({
  ensureLocalSessionHost: mocks.ensure,
  isLocalSessionHostUnavailable: (error: unknown) =>
    typeof error === 'object' && error !== null && 'code' in error,
  waitForLocalSessionHostRelease: vi.fn(async () => false),
}))
vi.mock('../local-session-paths', () => ({
  prepareLocalSessionHostPaths: mocks.preparePaths,
  refreshLocalSessionHostEndpoint: vi.fn(async (paths: object) => paths),
  resolveLocalSessionHostPaths: () => ({
    endpoint: '/tmp/openwaggle.sock',
    legacyDatabasePath: '/tmp/legacy.db',
    databasePath: '/tmp/session-host.db',
    recoveryDatabasePath: '/tmp/recovery.db',
    endpointCapabilityPath: null,
  }),
}))
vi.mock('../session-host-cutover-presence', () => ({
  sessionHostTargetExists: mocks.targetExists,
}))
vi.mock('../session-host-cutover', () => ({
  runSessionHostCutover: mocks.cutover,
}))
vi.mock('../legacy-session-writer-fence', () => ({
  withLegacySessionWriterFence: (operation: () => Promise<unknown>) => operation(),
}))
vi.mock('../session-host-renderer-bridge', () => ({
  startRemoteSessionHostRendererBridge: mocks.remoteBridge,
}))

import { prepareGuiSessionHostLifecycle } from '../gui-session-host-lifecycle'
import type { SessionHostPrelaunch } from '../session-host-prelaunch-handoff'

const PROFILE = '/tmp/openwaggle-test'
const unavailable = () => Object.assign(new Error('missing socket'), { code: 'ENOENT' })

function prelaunch(): SessionHostPrelaunch {
  return { userDataRoot: PROFILE, ended: new Promise(() => undefined), hasEnded: () => false }
}

function prelaunchedLifecycle(input: {
  readonly answered: boolean
  readonly startupMark?: (label: string) => void
  readonly onHostUnderway?: () => void
}) {
  const launched = prelaunch()
  const takePrelaunchedHost = vi.fn((): SessionHostPrelaunch | null => launched)
  const waitForPrelaunchedHost = vi.fn(async () => input.answered)
  return {
    launched,
    takePrelaunchedHost,
    waitForPrelaunchedHost,
    lifecycle: prepareGuiSessionHostLifecycle({
      userDataRoot: PROFILE,
      clientVersion: 'test',
      startupMark: input.startupMark ?? vi.fn(),
      ...(input.onHostUnderway ? { onHostUnderway: input.onHostUnderway } : {}),
      hasPrelaunchedHost: () => true,
      takePrelaunchedHost,
      waitForPrelaunchedHost,
    }),
  }
}

/*
 * The boot shim launches the desktop app's Host before the main bundle loads (W11). The GUI's own
 * Host start then waits for that Host instead of launching a second one, and leaves the store to
 * it: the Host creates its database meanwhile, which a GUI-side cutover would find half made.
 */
describe('GUI Session Host lifecycle with a Host launched by the boot shim', () => {
  beforeEach(() => {
    mocks.cutover.mockReset().mockResolvedValue(undefined)
    mocks.ensure.mockReset().mockResolvedValue(undefined)
    mocks.probe.mockReset().mockRejectedValueOnce(unavailable()).mockResolvedValue(undefined)
    mocks.remoteBridge.mockClear()
    mocks.targetExists.mockReset().mockResolvedValue(false)
  })

  it('waits for that Host and attaches to it without launching another', async () => {
    const startupMark = vi.fn()
    const onHostUnderway = vi.fn()
    const prepared = prelaunchedLifecycle({ answered: true, startupMark, onHostUnderway })
    const lifecycle = await prepared.lifecycle
    const controller = new AbortController()

    await lifecycle.start(controller.signal)

    expect(prepared.takePrelaunchedHost).toHaveBeenCalledWith(PROFILE)
    expect(prepared.waitForPrelaunchedHost).toHaveBeenCalledWith(
      expect.objectContaining({
        prelaunch: prepared.launched,
        clientKind: 'gui',
        signal: controller.signal,
      }),
    )
    expect(mocks.ensure).not.toHaveBeenCalled()
    expect(mocks.remoteBridge).toHaveBeenCalledOnce()
    expect(startupMark).toHaveBeenCalledWith('session-host-prelaunch-adopted')
    expect(startupMark).toHaveBeenLastCalledWith('session-host-listening')
    expect(onHostUnderway).toHaveBeenCalled()
    await lifecycle.stop()
  })

  it('leaves a missing store to that Host instead of moving it alongside', async () => {
    const lifecycle = await prelaunchedLifecycle({ answered: true }).lifecycle

    await lifecycle.start()

    expect(mocks.targetExists).not.toHaveBeenCalled()
    expect(mocks.cutover).not.toHaveBeenCalled()
    await lifecycle.stop()
  })

  it('still moves a missing store itself when no Host was launched for it', async () => {
    const lifecycle = await prepareGuiSessionHostLifecycle({
      userDataRoot: PROFILE,
      clientVersion: 'test',
      startupMark: vi.fn(),
      hasPrelaunchedHost: () => false,
      takePrelaunchedHost: () => null,
    })

    await lifecycle.start()

    expect(mocks.cutover).toHaveBeenCalledOnce()
    expect(mocks.ensure).toHaveBeenCalledOnce()
    await lifecycle.stop()
  })

  it('launches a Host the usual way once that one ended without answering', async () => {
    const prepared = prelaunchedLifecycle({ answered: false })
    const lifecycle = await prepared.lifecycle

    await lifecycle.start()

    expect(prepared.waitForPrelaunchedHost).toHaveBeenCalledOnce()
    expect(mocks.ensure).toHaveBeenCalledOnce()
    await lifecycle.stop()
  })

  it('moves a missing store itself before launching, once that Host ended without answering', async () => {
    const order: string[] = []
    let ended = false
    const launched: SessionHostPrelaunch = {
      userDataRoot: PROFILE,
      ended: new Promise(() => undefined),
      hasEnded: () => ended,
    }
    mocks.cutover.mockImplementation(async () => {
      order.push('cutover')
    })
    mocks.ensure.mockImplementation(async () => {
      order.push('launch')
    })
    const lifecycle = await prepareGuiSessionHostLifecycle({
      userDataRoot: PROFILE,
      clientVersion: 'test',
      startupMark: vi.fn(),
      hasPrelaunchedHost: () => true,
      takePrelaunchedHost: () => launched,
      waitForPrelaunchedHost: async () => {
        ended = true
        return false
      },
    })
    expect(mocks.cutover).not.toHaveBeenCalled()

    await lifecycle.start()

    expect(mocks.targetExists).toHaveBeenCalledOnce()
    expect(order).toEqual(['cutover', 'launch'])
    await lifecycle.stop()
  })

  it('leaves the store to that Host while it lives, even when it has not answered yet', async () => {
    const prepared = prelaunchedLifecycle({ answered: false })
    const lifecycle = await prepared.lifecycle

    await lifecycle.start()

    expect(mocks.targetExists).not.toHaveBeenCalled()
    expect(mocks.cutover).not.toHaveBeenCalled()
    await lifecycle.stop()
  })

  it('takes that Host once: a Retry starts the usual way', async () => {
    const prepared = prelaunchedLifecycle({ answered: true })
    const lifecycle = await prepared.lifecycle
    await lifecycle.start()
    await lifecycle.stop()
    prepared.takePrelaunchedHost.mockReturnValue(null)
    mocks.probe.mockRejectedValueOnce(unavailable()).mockResolvedValue(undefined)

    await lifecycle.start()

    expect(prepared.waitForPrelaunchedHost).toHaveBeenCalledOnce()
    expect(mocks.ensure).toHaveBeenCalledOnce()
    await lifecycle.stop()
  })
})

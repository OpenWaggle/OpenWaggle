import * as Effect from 'effect/Effect'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => Effect.Effect<unknown, unknown>>(),
  invalidateVcsStatus: vi.fn(),
  forgetRemoteRefProbes: vi.fn(),
  configureSourceControl: vi.fn(),
}))

vi.mock('../../typed-ipc', () => ({
  typedHandle: (
    channel: string,
    handler: (...args: unknown[]) => Effect.Effect<unknown, unknown>,
  ) => {
    mocks.handlers.set(channel, handler)
  },
}))
vi.mock('../vcs-status-cache', () => ({ invalidateVcsStatus: mocks.invalidateVcsStatus }))
vi.mock('../../../services/source-control/live-resolution-deps', () => ({
  forgetRemoteRefProbes: mocks.forgetRemoteRefProbes,
}))
vi.mock('../../../services/source-control/source-control-configuration', () => ({
  configureSourceControl: mocks.configureSourceControl,
  resolveChangeRequestOpenDestination: vi.fn(),
}))

vi.mock('../../../services/source-control/source-control-hosts-list', () => ({
  listSourceControlHosts: vi.fn(),
}))

const { registerSourceControlHandlers } = await import('../source-control-handler')

function invoke(channel: string, ...args: unknown[]) {
  const handler = mocks.handlers.get(channel)
  if (!handler) throw new Error(`${channel} is not registered`)
  return Effect.runPromise(handler({}, ...args))
}

describe('source-control IPC', () => {
  beforeEach(() => {
    mocks.handlers.clear()
    vi.clearAllMocks()
    registerSourceControlHandlers()
  })

  it('forgets cached status for a re-check after signing in', async () => {
    await invoke('source-control:refresh-status', '/work/app')

    expect(mocks.invalidateVcsStatus).toHaveBeenCalledWith('/work/app')
    expect(mocks.forgetRemoteRefProbes).toHaveBeenCalled()
  })

  it('rejects a working path that is not a path', async () => {
    await expect(invoke('source-control:refresh-status', 42)).rejects.toThrow()
    expect(mocks.invalidateVcsStatus).not.toHaveBeenCalled()
  })

  it('refreshes every status after a successful change', async () => {
    mocks.configureSourceControl.mockResolvedValue({ ok: true })

    await invoke('source-control:configure', {
      kind: 'set-host-provider',
      host: 'git.acme.io',
      provider: 'gitlab',
    })

    expect(mocks.invalidateVcsStatus).toHaveBeenCalled()
  })
})

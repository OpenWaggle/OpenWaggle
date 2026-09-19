import * as Effect from 'effect/Effect'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  ensureHost: vi.fn(),
  executeHostUi: vi.fn(),
  reconcileMcp: vi.fn(),
  refreshPaths: vi.fn(),
}))

vi.mock('../../session-host/local-session-host-launcher', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../session-host/local-session-host-launcher')>()),
  ensureLocalSessionHost: mocks.ensureHost,
}))
vi.mock('../../session-host/local-session-paths', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../session-host/local-session-paths')>()),
  refreshLocalSessionHostEndpoint: mocks.refreshPaths,
}))
vi.mock('../configured-host-ui-client', () => ({
  executeConfiguredHostUi: mocks.executeHostUi,
}))
vi.mock('../mcp-owner-runtime-reconciliation', () => ({
  reconcileMcpOwnerRuntime: mocks.reconcileMcp,
}))

import { resolveLocalSessionHostPaths } from '../../session-host/local-session-paths'
import {
  configureGuiSessionCommandClient,
  dispatchConfiguredGuiSessionCommand,
  GuiSessionHostRetiredForUpgradeError,
  invokeConfiguredHostUiRaw,
  reconcileConfiguredMcpOwnerRuntime,
  retireGuiSessionCommandClientForUpgrade,
} from '../gui-session-command-router'

const oldEndpoint = '\\\\.\\pipe\\openwaggle-old-session-host'
const newEndpoint = '\\\\.\\pipe\\openwaggle-new-session-host'

describe('GUI Host UI endpoint refresh', () => {
  beforeEach(() => {
    mocks.ensureHost.mockReset().mockResolvedValue(undefined)
    mocks.executeHostUi.mockReset().mockResolvedValue({ theme: 'dark' })
    mocks.reconcileMcp.mockReset().mockResolvedValue(undefined)
    mocks.refreshPaths.mockReset().mockImplementation(async (paths) => ({
      ...paths,
      endpoint: newEndpoint,
    }))
    configureGuiSessionCommandClient({
      paths: {
        ...resolveLocalSessionHostPaths({ userDataRoot: '/windows-profile', platform: 'win32' }),
        endpoint: oldEndpoint,
      },
      clientVersion: 'test',
    })
  })
  afterEach(() => configureGuiSessionCommandClient(null))

  it('uses the current protected endpoint for Host UI reads and MCP reconciliation', async () => {
    await expect(invokeConfiguredHostUiRaw('settings:get', [])).resolves.toEqual({
      handled: true,
      result: { theme: 'dark' },
    })
    await expect(reconcileConfiguredMcpOwnerRuntime('/project')).resolves.toBe(true)

    expect(mocks.executeHostUi.mock.calls[0]?.[0].client.paths.endpoint).toBe(newEndpoint)
    expect(mocks.reconcileMcp.mock.calls[0]?.[0].paths.endpoint).toBe(newEndpoint)
    expect(mocks.refreshPaths).toHaveBeenCalledTimes(2)
  })

  it('does not dispatch after the GUI route is retired during endpoint refresh', async () => {
    mocks.refreshPaths.mockImplementation(async (paths) => {
      retireGuiSessionCommandClientForUpgrade()
      return paths
    })

    await expect(invokeConfiguredHostUiRaw('settings:get', [])).rejects.toBeInstanceOf(
      GuiSessionHostRetiredForUpgradeError,
    )
    expect(mocks.executeHostUi).not.toHaveBeenCalled()
  })

  it('keeps concurrent Host UI and MCP operations valid when a command refreshes the same route', async () => {
    const gate = Promise.withResolvers<void>()
    mocks.refreshPaths.mockImplementation(async (paths) => {
      await gate.promise
      return { ...paths, endpoint: newEndpoint }
    })
    const hostUi = invokeConfiguredHostUiRaw('settings:get', [])
    const mcp = reconcileConfiguredMcpOwnerRuntime('/project')
    const execute = vi.fn().mockResolvedValue({ contract: 'session-query-v2' })
    const command = dispatchConfiguredGuiSessionCommand(
      {
        caller: { callerId: 'gui:local-user' },
        payload: {
          contract: 'session-query-v2',
          request: {
            contractVersion: 2,
            requestId: 'concurrent',
            query: { operation: 'status', sessionId: 'session-1' },
          },
        },
      },
      {
        execute,
        refreshPaths: async (paths) => ({ ...paths, endpoint: newEndpoint }),
      },
    )
    if (!command) throw new Error('Expected a remote GUI command.')
    await Effect.runPromise(command)
    gate.resolve()

    await expect(hostUi).resolves.toEqual({ handled: true, result: { theme: 'dark' } })
    await expect(mcp).resolves.toBe(true)
    expect(mocks.executeHostUi).toHaveBeenCalledOnce()
    expect(mocks.reconcileMcp).toHaveBeenCalledOnce()
  })

  it('recovers and retries a replay-safe Host UI read after the Host exits', async () => {
    const unavailable = Object.assign(new Error('Host exited'), { code: 'ECONNREFUSED' })
    mocks.executeHostUi.mockRejectedValueOnce(unavailable).mockResolvedValueOnce({ theme: 'dark' })

    await expect(invokeConfiguredHostUiRaw('settings:get', [])).resolves.toEqual({
      handled: true,
      result: { theme: 'dark' },
    })
    expect(mocks.ensureHost).toHaveBeenCalledOnce()
    expect(mocks.executeHostUi).toHaveBeenCalledTimes(2)
    expect(mocks.refreshPaths).toHaveBeenCalledTimes(2)
  })

  it.each(['extensions:list-packages', 'extensions:list-contributions'] as const)(
    'recovers the pure %s catalog after Host loss',
    async (channel) => {
      const unavailable = Object.assign(new Error('Host exited'), { code: 'ECONNRESET' })
      mocks.executeHostUi.mockRejectedValueOnce(unavailable).mockResolvedValueOnce([])

      await expect(invokeConfiguredHostUiRaw(channel, [])).resolves.toEqual({
        handled: true,
        result: [],
      })
      expect(mocks.ensureHost).toHaveBeenCalledOnce()
      expect(mocks.executeHostUi).toHaveBeenCalledTimes(2)
    },
  )

  it.each([
    ['mcp:get-settings', []],
    ['mcp:get-settings', [{ projectPath: '/project', reconcileRuntime: false }]],
    ['mcp:list-secrets', []],
    ['mcp:list-capabilities', [{ projectPath: '/project' }]],
    ['mcp:list-events', [{ sessionId: 'session-1' }]],
    ['mcp:list-event-subscriptions', [{ sessionId: 'session-1' }]],
    ['mcp:preview-imports', [{ projectPath: '/project', sources: ['codex'] }]],
    ['project-actions:discover-t3', ['/project']],
  ] as const)('recovers replay-safe %s after Host loss', async (channel, args) => {
    const unavailable = Object.assign(new Error('Host exited'), { code: 'ECONNRESET' })
    mocks.executeHostUi.mockRejectedValueOnce(unavailable).mockResolvedValueOnce([])

    await expect(invokeConfiguredHostUiRaw(channel, args)).resolves.toEqual({
      handled: true,
      result: [],
    })
    expect(mocks.ensureHost).toHaveBeenCalledOnce()
    expect(mocks.executeHostUi).toHaveBeenCalledTimes(2)
  })

  it('does not replay MCP settings reconciliation after an ambiguous Host failure', async () => {
    const unavailable = Object.assign(new Error('Host exited'), { code: 'ECONNRESET' })
    mocks.executeHostUi.mockRejectedValueOnce(unavailable)

    await expect(
      invokeConfiguredHostUiRaw('mcp:get-settings', [{ reconcileRuntime: true }]),
    ).rejects.toBe(unavailable)
    expect(mocks.ensureHost).not.toHaveBeenCalled()
    expect(mocks.executeHostUi).toHaveBeenCalledOnce()
  })

  it('recovers a replay-safe read when endpoint refresh itself reports Host loss', async () => {
    const unavailable = Object.assign(new Error('Host endpoint disappeared'), { code: 'ENOENT' })
    mocks.refreshPaths.mockRejectedValueOnce(unavailable).mockImplementation(async (paths) => ({
      ...paths,
      endpoint: newEndpoint,
    }))

    await expect(invokeConfiguredHostUiRaw('agent:list-active-runs', [])).resolves.toEqual({
      handled: true,
      result: { theme: 'dark' },
    })
    expect(mocks.ensureHost).toHaveBeenCalledOnce()
    expect(mocks.executeHostUi).toHaveBeenCalledOnce()
    expect(mocks.refreshPaths).toHaveBeenCalledTimes(2)
  })

  it('never replays a mutating Host UI command after an ambiguous transport failure', async () => {
    const unavailable = Object.assign(new Error('Host exited'), { code: 'ECONNRESET' })
    mocks.executeHostUi.mockRejectedValueOnce(unavailable)

    await expect(invokeConfiguredHostUiRaw('settings:update', [{}])).rejects.toBe(unavailable)
    expect(mocks.ensureHost).not.toHaveBeenCalled()
    expect(mocks.executeHostUi).toHaveBeenCalledOnce()
  })

  it('does not replay a read if the GUI route retires during recovery', async () => {
    const unavailable = Object.assign(new Error('Host exited'), { code: 'EPIPE' })
    mocks.executeHostUi.mockRejectedValueOnce(unavailable)
    mocks.ensureHost.mockImplementation(async () => retireGuiSessionCommandClientForUpgrade())

    await expect(invokeConfiguredHostUiRaw('sessions:list-page', [{}])).rejects.toBeInstanceOf(
      GuiSessionHostRetiredForUpgradeError,
    )
    expect(mocks.executeHostUi).toHaveBeenCalledOnce()
  })
})

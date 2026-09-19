import * as Effect from 'effect/Effect'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  executeHostUi: vi.fn(),
  reconcileMcp: vi.fn(),
  refreshPaths: vi.fn(),
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
})

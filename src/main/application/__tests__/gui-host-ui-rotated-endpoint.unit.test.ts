import * as Effect from 'effect/Effect'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  ensureHost: vi.fn(),
  executeHostUi: vi.fn(),
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

import { resolveLocalSessionHostPaths } from '../../session-host/local-session-paths'
import {
  configureGuiSessionCommandClient,
  dispatchConfiguredGuiSessionCommand,
  GuiSessionHostRetiredForUpgradeError,
  invokeConfiguredHostUiRaw,
  retireGuiSessionCommandClientForUpgrade,
} from '../gui-session-command-router'

const oldEndpoint = '\\\\.\\pipe\\openwaggle-old-session-host'
const newEndpoint = '\\\\.\\pipe\\openwaggle-new-session-host'

describe('GUI Host UI endpoint refresh', () => {
  beforeEach(() => {
    mocks.ensureHost.mockReset().mockResolvedValue(undefined)
    mocks.executeHostUi.mockReset().mockResolvedValue({ theme: 'dark' })
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

  it('uses the current protected endpoint for Host UI reads', async () => {
    await expect(invokeConfiguredHostUiRaw('settings:get', [])).resolves.toEqual({
      handled: true,
      result: { theme: 'dark' },
    })

    expect(mocks.executeHostUi.mock.calls[0]?.[0].client.paths.endpoint).toBe(newEndpoint)
    expect(mocks.refreshPaths).toHaveBeenCalledTimes(1)
  })

  it('replays a read after the Host connection reset, but never a server inspection', async () => {
    const reset = Object.assign(new Error('socket reset'), { code: 'ECONNRESET' })
    mocks.executeHostUi.mockRejectedValueOnce(reset).mockResolvedValue({ theme: 'dark' })

    await expect(invokeConfiguredHostUiRaw('settings:get', [])).resolves.toMatchObject({
      result: { theme: 'dark' },
    })
    expect(mocks.executeHostUi).toHaveBeenCalledTimes(2)

    // Inspecting an MCP server may have started its process before the reply was lost.
    mocks.executeHostUi.mockReset().mockRejectedValueOnce(reset)
    await expect(
      invokeConfiguredHostUiRaw('mcp:inspect-server', [{ projectPath: null, name: 'docs' }]),
    ).rejects.toBe(reset)
    expect(mocks.executeHostUi).toHaveBeenCalledTimes(1)
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

  it('keeps a concurrent Host UI operation valid when a command refreshes the same route', async () => {
    const gate = Promise.withResolvers<void>()
    mocks.refreshPaths.mockImplementation(async (paths) => {
      await gate.promise
      return { ...paths, endpoint: newEndpoint }
    })
    const hostUi = invokeConfiguredHostUiRaw('settings:get', [])
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
    expect(mocks.executeHostUi).toHaveBeenCalledOnce()
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
    ['mcp:list-secrets', []],
    [
      'project-actions:manage',
      [{ scope: { projectPath: '/project' }, operation: { type: 'discover' } }],
    ],
    [
      'agent-definitions:manage',
      [{ command: { operation: 'list', projectPath: '/project' }, selectedSourcePaths: [] }],
    ],
    [
      'agent-definitions:manage',
      [
        {
          command: {
            operation: 'import-plan',
            projectPath: '/project',
            sourcePath: '/source.md',
            targetScope: 'project',
          },
          selectedSourcePaths: ['/source.md'],
        },
      ],
    ],
    [
      'agent-definitions:manage',
      [
        {
          command: { operation: 'refresh-plan', projectPath: '/project', name: 'reviewer' },
          selectedSourcePaths: ['/source.md'],
        },
      ],
    ],
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

  it('does not replay an MCP secret write after an ambiguous Host failure', async () => {
    const unavailable = Object.assign(new Error('Host exited'), { code: 'ECONNRESET' })
    mocks.executeHostUi.mockRejectedValueOnce(unavailable)

    await expect(
      invokeConfiguredHostUiRaw('mcp:set-secret', [{ name: 'TOKEN', value: 'secret' }]),
    ).rejects.toBe(unavailable)
    expect(mocks.ensureHost).not.toHaveBeenCalled()
    expect(mocks.executeHostUi).toHaveBeenCalledOnce()
  })

  it.each(['write', 'duplicate', 'delete', 'import-apply', 'refresh-apply'] as const)(
    'does not replay an Agent definition %s mutation after an ambiguous Host failure',
    async (operation) => {
      const unavailable = Object.assign(new Error('Host exited'), { code: 'ECONNRESET' })
      mocks.executeHostUi.mockRejectedValueOnce(unavailable)

      await expect(
        invokeConfiguredHostUiRaw('agent-definitions:manage', [
          { command: { operation, projectPath: '/project' }, selectedSourcePaths: [] },
        ]),
      ).rejects.toBe(unavailable)
      expect(mocks.ensureHost).not.toHaveBeenCalled()
      expect(mocks.executeHostUi).toHaveBeenCalledOnce()
    },
  )

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

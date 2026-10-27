import { HOST_BACKED_MCP_GUI_CHANNELS } from '@shared/types/host-ui-protocol'
import { fromPartial } from '@total-typescript/shoehorn'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  McpAppRuntimeService,
  type McpAppRuntimeServiceShape,
} from '../../ports/mcp-app-runtime-service'
import {
  McpSecretVaultService,
  type McpSecretVaultServiceShape,
} from '../../ports/mcp-secret-vault-service'
import {
  McpServerRuntimeService,
  type McpServerRuntimeServiceShape,
} from '../../ports/mcp-server-runtime-service'
import {
  SessionProjectionRepository,
  type SessionProjectionRepositoryShape,
} from '../../ports/session-projection-repository'

const { hostHandleMock, typedHandleMock } = vi.hoisted(() => ({
  hostHandleMock: vi.fn(),
  typedHandleMock: vi.fn(),
}))

vi.mock('../typed-ipc', async () => {
  const { withLegacyHostOperation } = await import('./legacy-host-operations')
  return { hostHandle: withLegacyHostOperation(hostHandleMock), typedHandle: typedHandleMock }
})

import { registerMcpHandlers } from '../mcp-handler'

function makeTestLayer() {
  const setSecret = vi.fn<McpSecretVaultServiceShape['set']>(() => Effect.succeed([]))
  const removeSecret = vi.fn<McpSecretVaultServiceShape['remove']>(() => Effect.succeed([]))
  const vault = fromPartial<McpSecretVaultServiceShape>({
    list: () => Effect.succeed([{ name: 'TOKEN', updatedAt: 1 }]),
    set: setSecret,
    remove: removeSecret,
  })
  const readResource = vi.fn<McpAppRuntimeServiceShape['readResource']>(() =>
    Effect.succeed([{ uri: 'ui://app', text: '<p>app</p>' }]),
  )
  const callTool = vi.fn<McpAppRuntimeServiceShape['callTool']>(() =>
    Effect.succeed({ content: [], isError: false }),
  )
  const listCatalog = vi.fn<McpAppRuntimeServiceShape['listCatalog']>(() =>
    Effect.succeed({ resources: [{ uri: 'file:///a', name: 'a' }], prompts: [] }),
  )
  // The Session works in a worktree, so its servers start there.
  const sessions = fromPartial<SessionProjectionRepositoryShape>({
    getOptional: (id: string) =>
      Effect.succeed(
        id === 's1' || id === 'archived'
          ? fromPartial({
              id,
              projectPath: '/p',
              environmentMode: 'worktree',
              worktreePath: '/wt',
              archived: id === 'archived',
            })
          : null,
      ),
  })
  const switchedOff = new Set<string>()
  const setSessionMcpEnabled = vi.fn<McpServerRuntimeServiceShape['setSessionMcpEnabled']>(
    (sessionId, enabled) =>
      Effect.sync(() => {
        if (enabled) switchedOff.delete(sessionId)
        else switchedOff.add(sessionId)
      }),
  )
  const serverRuntime = fromPartial<McpServerRuntimeServiceShape>({
    getSessionMcpEnabled: (sessionId: string) => Effect.succeed(!switchedOff.has(sessionId)),
    setSessionMcpEnabled,
  })
  return {
    layer: Layer.mergeAll(
      Layer.succeed(McpServerRuntimeService, serverRuntime),
      Layer.succeed(McpSecretVaultService, vault),
      Layer.succeed(McpAppRuntimeService, { readResource, listCatalog, callTool }),
      Layer.succeed(SessionProjectionRepository, sessions),
    ),
    setSecret,
    removeSecret,
    setSessionMcpEnabled,
    readResource,
    listCatalog,
    callTool,
  }
}

function getRegisteredHandler(name: string, layer: ReturnType<typeof makeTestLayer>['layer']) {
  const call = hostHandleMock.mock.calls.find(
    (candidate: readonly unknown[]) => candidate[0] === name && typeof candidate[1] === 'function',
  )
  const handler = call?.[1]
  if (typeof handler !== 'function') throw new Error(`${name} was not registered`)
  return (...args: unknown[]) => Effect.runPromise(Effect.provide(handler(...args), layer))
}

describe('MCP IPC handlers', () => {
  beforeEach(() => {
    hostHandleMock.mockReset()
    typedHandleMock.mockReset()
    registerMcpHandlers()
  })

  it('routes every MCP handler through the Host owner', () => {
    const hostChannels = hostHandleMock.mock.calls.map((call) => call[0])

    expect(new Set(hostChannels)).toEqual(new Set(HOST_BACKED_MCP_GUI_CHANNELS))
    expect(typedHandleMock).not.toHaveBeenCalled()
  })

  it('lists, writes, and removes vault secrets', async () => {
    const test = makeTestLayer()

    await expect(getRegisteredHandler('mcp:list-secrets', test.layer)({})).resolves.toEqual([
      { name: 'TOKEN', updatedAt: 1 },
    ])
    await getRegisteredHandler('mcp:set-secret', test.layer)({}, { name: 'TOKEN', value: 'v' })
    await getRegisteredHandler('mcp:remove-secret', test.layer)({}, { name: 'TOKEN' })

    expect(test.setSecret).toHaveBeenCalledWith({ name: 'TOKEN', value: 'v' })
    expect(test.removeSecret).toHaveBeenCalledWith({ name: 'TOKEN' })
  })

  it("reads and switches a Session's MCP switch, which starts on", async () => {
    const test = makeTestLayer()
    const get = getRegisteredHandler('mcp:get-session-enabled', test.layer)
    const set = getRegisteredHandler('mcp:set-session-enabled', test.layer)

    await expect(get({}, { sessionId: 's1' })).resolves.toBe(true)
    await expect(set({}, { sessionId: 's1', enabled: false })).resolves.toBe(false)
    await expect(get({}, { sessionId: 's1' })).resolves.toBe(false)
    await expect(set({}, { sessionId: 's1', enabled: true })).resolves.toBe(true)
    expect(test.setSessionMcpEnabled).toHaveBeenCalledWith('s1', false)
  })

  it('rejects a malformed Session MCP switch before it reaches the Host', async () => {
    const test = makeTestLayer()

    await expect(
      getRegisteredHandler('mcp:set-session-enabled', test.layer)({}, { sessionId: 's1' }),
    ).rejects.toThrow()
    await expect(
      getRegisteredHandler('mcp:get-session-enabled', test.layer)({}, { sessionId: '' }),
    ).rejects.toThrow()
    expect(test.setSessionMcpEnabled).not.toHaveBeenCalled()
  })

  it('rejects a malformed secret write before it reaches the vault', async () => {
    const test = makeTestLayer()

    await expect(
      getRegisteredHandler('mcp:set-secret', test.layer)({}, { name: 'TOKEN' }),
    ).rejects.toThrow()
    expect(test.setSecret).not.toHaveBeenCalled()
  })

  it("reads an MCP App's ui:// resource over the Session's connection to its server", async () => {
    const test = makeTestLayer()

    const result = await getRegisteredHandler('mcp:read-resource', test.layer)(
      {},
      {
        projectPath: '/somewhere-else',
        sessionId: 's1',
        serverInstanceId: 'figma',
        serverConfigHash: 'mcp-server:abc',
        uri: 'ui://app',
      },
    )

    // The project and working path are the Session's own, not what the request says.
    expect(test.readResource).toHaveBeenCalledWith({
      projectPath: '/p',
      workingPath: '/wt',
      sessionId: 's1',
      serverName: 'figma',
      serverIdentity: 'mcp-server:abc',
      uri: 'ui://app',
    })
    expect(result).toEqual({
      contents: [{ uri: 'ui://app', text: '<p>app</p>' }],
      attribution: { serverInstanceId: 'figma', serverLabel: 'figma' },
    })
  })

  it("lists an MCP App server's resources and prompts for the App", async () => {
    const test = makeTestLayer()

    const result = await getRegisteredHandler('mcp:list-app-catalog', test.layer)(
      {},
      { sessionId: 's1', serverInstanceId: 'figma', serverConfigHash: 'mcp-server:abc' },
    )

    expect(test.listCatalog).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: 's1', serverName: 'figma', workingPath: '/wt' }),
    )
    expect(result).toEqual({
      resources: [{ uri: 'file:///a', name: 'a' }],
      prompts: [],
      attribution: { serverInstanceId: 'figma', serverLabel: 'figma' },
    })
  })

  it('refuses an MCP App request for an archived Session without opening its server', async () => {
    const test = makeTestLayer()

    await expect(
      getRegisteredHandler('mcp:read-resource', test.layer)(
        {},
        {
          sessionId: 'archived',
          serverInstanceId: 'figma',
          serverConfigHash: 'x',
          uri: 'ui://app',
        },
      ),
    ).rejects.toThrow('archived')
    expect(test.readResource).not.toHaveBeenCalled()
  })

  it('refuses an MCP App request for a Session that does not exist', async () => {
    const test = makeTestLayer()

    await expect(
      getRegisteredHandler('mcp:read-resource', test.layer)(
        {},
        { sessionId: 'gone', serverInstanceId: 'figma', serverConfigHash: 'x', uri: 'ui://app' },
      ),
    ).rejects.toThrow('The Session of this MCP App is gone.')
  })

  it('refuses an MCP App request without the Session that opened it', async () => {
    const test = makeTestLayer()

    await expect(
      getRegisteredHandler('mcp:call-app-tool', test.layer)(
        {},
        { serverInstanceId: 'figma', serverConfigHash: 'x', toolName: 't', arguments: {} },
      ),
    ).rejects.toThrow('MCP Apps need the Session whose tool result opened them.')
    expect(test.callTool).not.toHaveBeenCalled()
  })
})

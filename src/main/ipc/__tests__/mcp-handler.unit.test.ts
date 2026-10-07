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

const { hostHandleMock, typedHandleMock } = vi.hoisted(() => ({
  hostHandleMock: vi.fn(),
  typedHandleMock: vi.fn(),
}))

vi.mock('../typed-ipc', () => ({ hostHandle: hostHandleMock, typedHandle: typedHandleMock }))

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
  return {
    layer: Layer.merge(
      Layer.succeed(McpSecretVaultService, vault),
      Layer.succeed(McpAppRuntimeService, { readResource, callTool }),
    ),
    setSecret,
    removeSecret,
    readResource,
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
        projectPath: '/p',
        sessionId: 's1',
        serverInstanceId: 'figma',
        serverConfigHash: 'mcp-server:abc',
        uri: 'ui://app',
      },
    )

    expect(test.readResource).toHaveBeenCalledWith({
      projectPath: '/p',
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

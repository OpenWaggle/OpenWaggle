import { HOST_BACKED_MCP_GUI_CHANNELS } from '@shared/types/host-ui-protocol'
import { fromPartial } from '@total-typescript/shoehorn'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MCP_APPS_UNAVAILABLE_MESSAGE } from '../../application/mcp-app-operations'
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
  return { layer: Layer.succeed(McpSecretVaultService, vault), setSecret, removeSecret }
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

  it.each(['mcp:read-resource', 'mcp:call-app-tool'])(
    'fails %s until MCP Apps run on Pi',
    async (channel) => {
      const test = makeTestLayer()

      await expect(getRegisteredHandler(channel, test.layer)({}, {})).rejects.toThrow(
        MCP_APPS_UNAVAILABLE_MESSAGE,
      )
    },
  )
})

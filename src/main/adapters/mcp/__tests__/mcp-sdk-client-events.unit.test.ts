import { Client, InMemoryTransport } from '@modelcontextprotocol/client'
import { McpServer } from '@modelcontextprotocol/server'
import { MCP_LATEST_PROTOCOL_VERSION } from '@shared/constants/mcp'
import { describe, expect, it, vi } from 'vitest'
import { getMcpProtocolOptions } from '../runtime/protocol-negotiation'
import { createMcpEventMethods } from '../runtime/sdk-client-events'
import type { McpClientConnection } from '../runtime/types'

async function fixture(protocolVersion?: string) {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  const server = new McpServer({ name: 'event-fixture', version: '1.0.0' })
  await server.connect(serverTransport)
  const client = new Client(
    { name: 'OpenWaggle event fixture', version: '1.0.0' },
    getMcpProtocolOptions({
      instanceId: 'event-server',
      name: 'event-server',
      sourcePath: '/project/.mcp.json',
      configHash: 'event-config',
      allowUnsandboxed: false,
      permissions: { readRoots: ['.'], writeRoots: [], allowNetwork: false },
      definition: {
        command: 'event-server',
        ...(protocolVersion ? { protocolVersion } : {}),
      },
    }),
  )
  await client.connect(clientTransport)
  return { client, server, serverTransport }
}

describe('MCP SDK event subscriptions', () => {
  it('uses subscriptions/listen for the modern protocol and dispatches notifications', async () => {
    const { client, server, serverTransport } = await fixture()
    const close = vi.fn(async () => undefined)
    const neverClosed = new Promise<'local' | 'graceful' | 'remote'>(() => undefined)
    vi.spyOn(client, 'getNegotiatedProtocolVersion').mockReturnValue(MCP_LATEST_PROTOCOL_VERSION)
    const listen = vi.spyOn(client, 'listen').mockResolvedValue({
      honoredFilter: { toolsListChanged: true, resourceSubscriptions: ['docs://readme'] },
      closed: neverClosed,
      close,
    })
    const received =
      Promise.withResolvers<
        Parameters<Parameters<McpClientConnection['subscribeEvents']>[0]['onEvent']>[0]
      >()

    const subscription = await createMcpEventMethods(client, undefined).subscribeEvents({
      resourceUris: ['docs://readme'],
      onEvent: received.resolve,
    })
    await serverTransport.send({
      jsonrpc: '2.0',
      method: 'notifications/tools/list_changed',
    })

    await expect(received.promise).resolves.toEqual({ kind: 'tools-list-changed', payload: {} })
    expect(subscription).toMatchObject({
      mode: 'modern-listen',
      resourceUris: ['docs://readme'],
    })
    expect(listen).toHaveBeenCalledWith(
      {
        toolsListChanged: true,
        promptsListChanged: true,
        resourcesListChanged: true,
        resourceSubscriptions: ['docs://readme'],
      },
      expect.objectContaining({ timeout: expect.any(Number) }),
    )
    await subscription.close()
    expect(close).toHaveBeenCalledTimes(1)
    await client.close()
    await server.close()
  })

  it('uses explicit resources/subscribe and unsolicited notifications for legacy servers', async () => {
    const { client, server, serverTransport } = await fixture('2024-11-05')
    const subscribeResource = vi.spyOn(client, 'subscribeResource').mockResolvedValue({})
    const unsubscribeResource = vi.spyOn(client, 'unsubscribeResource').mockResolvedValue({})
    const received =
      Promise.withResolvers<
        Parameters<Parameters<McpClientConnection['subscribeEvents']>[0]['onEvent']>[0]
      >()

    const subscription = await createMcpEventMethods(client, undefined).subscribeEvents({
      resourceUris: ['docs://readme'],
      onEvent: received.resolve,
    })
    await serverTransport.send({
      jsonrpc: '2.0',
      method: 'notifications/resources/updated',
      params: { uri: 'docs://readme' },
    })

    await expect(received.promise).resolves.toEqual({
      kind: 'resource-updated',
      payload: { uri: 'docs://readme' },
    })
    expect(subscription.mode).toBe('legacy-notifications')
    expect(subscribeResource).toHaveBeenCalledWith(
      { uri: 'docs://readme' },
      expect.objectContaining({ timeout: expect.any(Number) }),
    )
    await subscription.close()
    expect(unsubscribeResource).toHaveBeenCalledWith(
      { uri: 'docs://readme' },
      expect.objectContaining({ timeout: expect.any(Number) }),
    )
    await client.close()
    await server.close()
  })
})

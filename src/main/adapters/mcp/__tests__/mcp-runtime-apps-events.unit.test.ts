import { describe, expect, it, vi } from 'vitest'
import { createMcpRuntimeService } from '../runtime/runtime-service-factory'
import type { McpClientConnection } from '../runtime/types'
import { connection, server, snapshot } from './mcp-runtime-test-utils'

describe('first-party MCP Apps and Event Inbox runtime', () => {
  it('returns an MCP App launch payload and brokers App-originated calls through the same server connection', async () => {
    const callTool = vi.fn(async () => ({
      content: [{ type: 'text', text: 'interactive result' }],
      structuredContent: { value: 42 },
      isError: false,
    }))
    const service = createMcpRuntimeService({
      connect: async () =>
        connection({
          capabilities: ['tools', 'resources'],
          callTool,
          tools: [
            {
              name: 'interactive_tool',
              title: 'Interactive tool',
              inputSchema: { type: 'object' },
              meta: { ui: { resourceUri: 'ui://interactive/app' } },
            },
          ],
        }),
    })
    const turn = snapshot({
      servers: [
        server({
          definition: {
            command: 'interactive-mcp',
            security: { networkDomains: ['https://assets.example.com'] },
          },
        }),
      ],
    })
    const listed = await service.executeGateway(turn, { operation: 'list' })
    const handle = listed.tools?.[0]?.handle ?? ''

    const called = await service.executeGateway(turn, {
      operation: 'call',
      handle,
      arguments: { value: 1 },
    })
    const appCalled = await service.callAppTool({
      snapshot: turn,
      serverInstanceId: 'server-1',
      toolName: 'interactive_tool',
      arguments: { value: 2 },
    })

    expect(called.app).toEqual({
      descriptor: expect.objectContaining({
        resourceUri: 'ui://interactive/app',
        allowedNetworkDomains: ['https://assets.example.com'],
      }),
      toolResult: {
        content: [{ type: 'text', text: 'interactive result' }],
        structuredContent: { value: 42 },
        isError: false,
      },
    })
    expect(appCalled).toEqual(
      expect.objectContaining({
        attribution: expect.objectContaining({ toolName: 'interactive_tool' }),
      }),
    )
    expect(callTool).toHaveBeenNthCalledWith(2, {
      name: 'interactive_tool',
      arguments: { value: 2 },
      signal: undefined,
    })
  })

  it('collects events only after an explicit subscription and closes it transparently', async () => {
    let publish: Parameters<McpClientConnection['subscribeEvents']>[0]['onEvent'] | undefined
    const closeSubscription = vi.fn(async () => undefined)
    const service = createMcpRuntimeService({
      connect: async () =>
        connection({
          subscribeEvents: async ({ onEvent, resourceUris }) => {
            publish = onEvent
            return {
              mode: 'legacy-notifications',
              resourceUris,
              close: closeSubscription,
            }
          },
        }),
      now: () => 100,
    })
    const turn = snapshot()

    expect(await service.getEvents(turn.sessionId)).toEqual([])
    const active = await service.setEventSubscription({
      snapshot: turn,
      serverInstanceId: 'server-1',
      enabled: true,
      resourceUris: ['docs://readme'],
    })
    publish?.({ kind: 'resource-updated', payload: { uri: 'docs://readme' } })

    expect(active).toMatchObject({ active: true, mode: 'legacy-notifications' })
    expect(await service.getEvents(turn.sessionId)).toEqual([
      expect.objectContaining({
        serverInstanceId: 'server-1',
        kind: 'resource-updated',
        payload: { uri: 'docs://readme' },
        read: false,
      }),
    ])

    const inactive = await service.setEventSubscription({
      snapshot: turn,
      serverInstanceId: 'server-1',
      enabled: false,
      resourceUris: [],
    })
    expect(closeSubscription).toHaveBeenCalledTimes(1)
    expect(inactive).toMatchObject({
      active: false,
      mode: 'inactive',
      detail: expect.stringContaining('Remote work may continue'),
    })
  })

  it('does not connect when an Event Inbox subscription is explicitly disabled', async () => {
    const connect = vi.fn(async () => connection())
    const service = createMcpRuntimeService({ connect })

    await service.setEventSubscription({
      snapshot: snapshot(),
      serverInstanceId: 'server-1',
      enabled: false,
      resourceUris: [],
    })

    expect(connect).not.toHaveBeenCalled()
  })
})

import { MCP_CONFIG } from '@shared/constants/mcp'
import type { McpEventRecord } from '@shared/types/mcp'
import { describe, expect, it, vi } from 'vitest'
import type { McpClientConnection } from '../runtime/types'
import {
  connection,
  createMcpRuntimeServiceForTests as createMcpRuntimeService,
  server,
  snapshot,
} from './mcp-runtime-test-utils'

function retainedEventBytes(events: readonly McpEventRecord[]) {
  return events.reduce(
    (total, event) => total + Buffer.byteLength(JSON.stringify(event), 'utf8'),
    0,
  )
}

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
    expect(await service.getEvents(turn.sessionId)).toHaveLength(1)

    await service.setEventSubscription({
      snapshot: turn,
      serverInstanceId: 'server-1',
      enabled: true,
      resourceUris: [],
    })
    const publishAfterResubscribe = publish
    await service.disposeSession(turn.sessionId)
    expect(closeSubscription).toHaveBeenCalledTimes(2)
    expect(await service.getEvents(turn.sessionId)).toEqual([])
    publishAfterResubscribe?.({ kind: 'task-status', payload: { status: 'late' } })
    expect(await service.getEvents(turn.sessionId)).toEqual([])
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

  it('truncates one oversized event before retaining it', async () => {
    let publish: Parameters<McpClientConnection['subscribeEvents']>[0]['onEvent'] | undefined
    const service = createMcpRuntimeService({
      connect: async () =>
        connection({
          subscribeEvents: async ({ onEvent, resourceUris }) => {
            publish = onEvent
            return {
              mode: 'modern-listen',
              resourceUris,
              close: async () => undefined,
            }
          },
        }),
    })
    const turn = snapshot()
    await service.setEventSubscription({
      snapshot: turn,
      serverInstanceId: 'server-1',
      enabled: true,
      resourceUris: [],
    })

    publish?.({
      kind: 'task-status',
      payload: { text: 'x'.repeat(MCP_CONFIG.MAX_EVENT_INBOX_EVENT_BYTES) },
    })

    const events = await service.getEvents(turn.sessionId)
    expect(events).toHaveLength(1)
    expect(events[0]?.payload).toEqual(
      expect.objectContaining({ truncated: true, originalBytes: expect.any(Number) }),
    )
    expect(Buffer.byteLength(JSON.stringify(events[0]), 'utf8')).toBeLessThanOrEqual(
      MCP_CONFIG.MAX_EVENT_INBOX_EVENT_BYTES,
    )
  })

  it('evicts oldest events to enforce per-session and global retained-byte budgets', async () => {
    const publishers = new Map<
      string,
      Parameters<McpClientConnection['subscribeEvents']>[0]['onEvent']
    >()
    const service = createMcpRuntimeService({
      connect: async ({ snapshot: turn }) =>
        connection({
          subscribeEvents: async ({ onEvent, resourceUris }) => {
            publishers.set(turn.sessionId, onEvent)
            return {
              mode: 'modern-listen',
              resourceUris,
              close: async () => undefined,
            }
          },
        }),
    })
    const sessionCount = 10
    const eventsPerSession = 20
    const payload = { text: 'x'.repeat(64_000) }

    for (let sessionIndex = 0; sessionIndex < sessionCount; sessionIndex += 1) {
      const turn = snapshot({
        id: `snapshot-${String(sessionIndex)}`,
        sessionId: `session-${String(sessionIndex)}`,
        revision: `revision-${String(sessionIndex)}`,
      })
      await service.setEventSubscription({
        snapshot: turn,
        serverInstanceId: 'server-1',
        enabled: true,
        resourceUris: [],
      })
      const publish = publishers.get(turn.sessionId)
      if (!publish) throw new Error(`Missing Event Inbox publisher for ${turn.sessionId}.`)
      for (let eventIndex = 0; eventIndex < eventsPerSession; eventIndex += 1) {
        publish({ kind: 'task-status', payload: { ...payload, eventIndex } })
      }
      const sessionEvents = await service.getEvents(turn.sessionId)
      expect(retainedEventBytes(sessionEvents)).toBeLessThanOrEqual(
        MCP_CONFIG.MAX_EVENT_INBOX_SESSION_BYTES,
      )
      expect(sessionEvents.at(-1)?.payload).toEqual({
        ...payload,
        eventIndex: eventsPerSession - 1,
      })
    }

    const allEvents = await service.getEvents()
    expect(retainedEventBytes(allEvents)).toBeLessThanOrEqual(
      MCP_CONFIG.MAX_EVENT_INBOX_GLOBAL_BYTES,
    )
    expect(allEvents.length).toBeLessThanOrEqual(MCP_CONFIG.MAX_EVENT_INBOX_GLOBAL_ITEMS)
  })

  it('drops an event storm after one visible overflow record per intake window', async () => {
    let publish: Parameters<McpClientConnection['subscribeEvents']>[0]['onEvent'] | undefined
    const service = createMcpRuntimeService({
      connect: async () =>
        connection({
          subscribeEvents: async ({ onEvent, resourceUris }) => {
            publish = onEvent
            return {
              mode: 'modern-listen',
              resourceUris,
              close: async () => undefined,
            }
          },
        }),
    })
    const turn = snapshot()
    await service.setEventSubscription({
      snapshot: turn,
      serverInstanceId: 'server-1',
      enabled: true,
      resourceUris: [],
    })

    for (
      let eventIndex = 0;
      eventIndex < MCP_CONFIG.MAX_EVENT_INBOX_EVENTS_PER_WINDOW + 25;
      eventIndex += 1
    ) {
      publish?.({ kind: 'task-status', payload: { eventIndex } })
    }

    const events = await service.getEvents(turn.sessionId)
    expect(events).toHaveLength(MCP_CONFIG.MAX_EVENT_INBOX_EVENTS_PER_WINDOW + 1)
    expect(events.at(-1)).toMatchObject({
      kind: 'server-log',
      payload: { dropped: true, detail: expect.stringContaining('rate exceeded') },
    })
  })
})

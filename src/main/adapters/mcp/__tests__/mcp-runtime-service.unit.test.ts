import { Client, InMemoryTransport } from '@modelcontextprotocol/client'
import { McpServer } from '@modelcontextprotocol/server'
import type { McpTurnSnapshotServer } from '@shared/types/mcp'
import { describe, expect, it, vi } from 'vitest'
import { getMcpProtocolOptions } from '../runtime/protocol-negotiation'
import {
  connection,
  createMcpRuntimeServiceForTests as createMcpRuntimeService,
  server,
  snapshot,
} from './mcp-runtime-test-utils'

describe('first-party MCP gateway runtime', () => {
  it('keeps server and tool identities out of the model-facing list schema', async () => {
    const connect = vi.fn(async () => connection())
    const service = createMcpRuntimeService({
      connect,
      createHandleKey: () => Buffer.alloc(32, 7),
    })

    const result = await service.executeGateway(snapshot(), { operation: 'list' })

    expect(connect).toHaveBeenCalledTimes(1)
    expect(result.tools).toEqual([
      expect.objectContaining({
        handle: expect.stringMatching(/^mcp_[A-Za-z0-9_-]{24}$/),
        title: 'Search documentation',
      }),
    ])
    expect(result.tools?.[0]).not.toHaveProperty('serverLabel')
    expect(result.tools?.[0]).not.toHaveProperty('inputSchema')
    expect(JSON.stringify(result)).not.toContain('private-docs-server')
    expect(JSON.stringify(result)).not.toContain('search_private_docs')
  })

  it('searches, describes, and calls through a snapshot-bound opaque handle', async () => {
    const callTool = vi.fn(async () => ({
      content: [{ type: 'text', text: 'found' }],
      structuredContent: { matches: 1 },
      isError: false,
    }))
    const service = createMcpRuntimeService({
      connect: async () => connection({ callTool }),
      createHandleKey: () => Buffer.alloc(32, 9),
    })
    const turn = snapshot()

    const searched = await service.executeGateway(turn, {
      operation: 'search',
      query: 'project documentation',
    })
    const handle = searched.tools?.[0]?.handle ?? ''
    const described = await service.executeGateway(turn, { operation: 'describe', handle })
    const called = await service.executeGateway(turn, {
      operation: 'call',
      handle,
      arguments: { query: 'MCP' },
    })

    expect(described.tools?.[0]?.inputSchema).toMatchObject({ type: 'object' })
    expect(callTool).toHaveBeenCalledWith({
      name: 'search_private_docs',
      arguments: { query: 'MCP' },
      signal: undefined,
    })
    expect(called).toMatchObject({
      result: { matches: 1 },
      attribution: {
        serverInstanceId: 'server-1',
        serverLabel: 'private-docs-server',
        toolName: 'search_private_docs',
      },
    })
  })

  it('invalidates handles and closes connections at a new turn revision', async () => {
    const closeFirst = vi.fn(async () => undefined)
    const connect = vi
      .fn()
      .mockResolvedValueOnce(connection({ close: closeFirst }))
      .mockResolvedValueOnce(connection())
    const service = createMcpRuntimeService({
      connect,
      createHandleKey: () => Buffer.alloc(32, 3),
    })
    const first = snapshot()
    const firstList = await service.executeGateway(first, { operation: 'list' })
    const staleHandle = firstList.tools?.[0]?.handle ?? ''
    const second = snapshot({ id: 'snapshot-2', revision: 'revision-2' })

    await service.executeGateway(second, { operation: 'list' })

    expect(closeFirst).toHaveBeenCalledTimes(1)
    await expect(
      service.executeGateway(second, { operation: 'describe', handle: staleHandle }),
    ).rejects.toThrow('Unknown or stale')
  })

  it('isolates management browsing from active-turn connection revisions', async () => {
    const closeActive = vi.fn(async () => undefined)
    const closeManagement = vi.fn(async () => undefined)
    const connect = vi.fn(async ({ snapshot: turn }) =>
      connection({ close: turn.runtimeNamespace ? closeManagement : closeActive }),
    )
    const service = createMcpRuntimeService({ connect })
    const activeTurn = snapshot({ sessionId: 'active-session', revision: 'active-revision' })
    const managementView = snapshot({
      sessionId: 'active-session',
      runtimeNamespace: 'mcp-management:active-session',
      revision: 'management-revision',
    })

    await service.executeGateway(activeTurn, { operation: 'list' })
    await service.browseCapabilities(managementView)

    expect(connect).toHaveBeenCalledTimes(2)
    expect(closeActive).not.toHaveBeenCalled()
    await service.disposeAll()
    expect(closeActive).toHaveBeenCalledTimes(1)
    expect(closeManagement).toHaveBeenCalledTimes(1)
  })

  it('reconciles idle management connections without interrupting an active turn', async () => {
    const closeActive = vi.fn(async () => undefined)
    const closeManagement = vi.fn(async () => undefined)
    const service = createMcpRuntimeService({
      connect: async ({ snapshot: turn }) =>
        connection({ close: turn.runtimeNamespace ? closeManagement : closeActive }),
    })
    const activeTurn = snapshot({ sessionId: 'preserved-active-session' })
    const managementView = snapshot({
      sessionId: activeTurn.sessionId,
      runtimeNamespace: `mcp-management:${activeTurn.sessionId}`,
    })

    await service.prepareTurn({ sessionId: activeTurn.sessionId, snapshot: activeTurn })
    await service.executeGateway(activeTurn, { operation: 'list' })
    await service.browseCapabilities(managementView)
    await service.reconcileIdleConnections()

    expect(closeManagement).toHaveBeenCalledTimes(1)
    expect(closeActive).not.toHaveBeenCalled()
    expect(await service.getConnectionStatuses()).toEqual([
      expect.objectContaining({
        runtimeNamespace: activeTurn.sessionId,
        connectionState: 'connected',
        capabilities: ['tools'],
      }),
    ])
    await service.disposeSession(activeTurn.sessionId)
  })

  it('isolates optional connection failures and reports a transparent notice', async () => {
    const optional = server({ instanceId: 'optional', name: 'optional-server' })
    const healthy = server({ instanceId: 'healthy', name: 'healthy-server' })
    const service = createMcpRuntimeService({
      connect: async ({ server: selected }) => {
        if (selected.instanceId === 'optional') throw new Error('connection refused')
        return connection()
      },
    })
    const turn = snapshot({ servers: [optional, healthy] })

    const result = await service.executeGateway(turn, { operation: 'list' })
    const notices = await service.getNotices(turn.sessionId)

    expect(result.tools).toHaveLength(1)
    expect(notices).toEqual([
      expect.objectContaining({
        severity: 'warning',
        title: 'optional-server MCP server could not connect',
        detail: 'connection refused',
        action: expect.any(String),
      }),
    ])
  })

  it('fails the gateway when a required server cannot connect', async () => {
    const required = server({ definition: { command: 'required', required: true } })
    const service = createMcpRuntimeService({
      connect: async () => {
        throw new Error('missing executable')
      },
    })

    await expect(
      service.executeGateway(snapshot({ servers: [required] }), { operation: 'list' }),
    ).rejects.toThrow('Required MCP server private-docs-server could not connect')
  })

  it('connects only servers whose direct tools were explicitly selected', async () => {
    const connect = vi.fn(async () => connection())
    const service = createMcpRuntimeService({ connect })

    expect(await service.listDirectTools(snapshot())).toEqual([])
    expect(connect).not.toHaveBeenCalled()

    const directSnapshot = snapshot({
      revision: 'direct-revision',
      servers: [
        server({
          definition: { command: 'docs-mcp', directTools: ['search_private_docs'] },
        }),
      ],
    })
    const tools = await service.listDirectTools(directSnapshot)

    expect(connect).toHaveBeenCalledTimes(1)
    expect(tools).toEqual([
      expect.objectContaining({
        modelName: expect.stringMatching(/^mcp_[a-z0-9_-]+_[a-f0-9]{8}$/),
        title: 'Search documentation',
        serverLabel: 'private-docs-server',
      }),
    ])
  })
})

describe('MCP protocol compatibility matrix', () => {
  it.each([
    ['auto', undefined, 'auto', 6],
    ['modern-only', undefined, 'pin', 1],
    ['legacy-stateful-http', undefined, 'legacy', 5],
    ['legacy-sse', undefined, 'legacy', 5],
    ['legacy-websocket', undefined, 'legacy', 5],
    ['auto', '2024-11-05', 'legacy', 1],
    ['auto', '2026-07-28', 'pin', 1],
  ] as const)(
    'uses %s with protocol pin %s as %s negotiation',
    (compatibility, protocolVersion, expectedMode, versionCount) => {
      const definition: McpTurnSnapshotServer['definition'] = {
        command: 'mcp',
        compatibility,
        ...(protocolVersion ? { protocolVersion } : {}),
      }
      const options = getMcpProtocolOptions(server({ definition }))
      const mode = options.versionNegotiation?.mode

      expect(typeof mode === 'object' ? 'pin' : mode).toBe(expectedMode)
      expect(options.supportedProtocolVersions).toHaveLength(versionCount)
    },
  )

  it.each(['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05', '2024-10-07'])(
    'connects to a legacy server using the pinned %s initialize handshake',
    async (protocolVersion) => {
      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
      const legacyServer = new McpServer({ name: 'legacy-fixture', version: '1.0.0' })
      await legacyServer.connect(serverTransport)
      const definition: McpTurnSnapshotServer['definition'] = {
        command: 'legacy-mcp',
        protocolVersion,
      }
      const client = new Client(
        { name: 'OpenWaggle compatibility fixture', version: '1.0.0' },
        { capabilities: {}, ...getMcpProtocolOptions(server({ definition })) },
      )

      try {
        await client.connect(clientTransport)
        expect(client.getProtocolEra()).toBe('legacy')
        expect(client.getNegotiatedProtocolVersion()).toBe(protocolVersion)
      } finally {
        await client.close()
        await legacyServer.close()
      }
    },
  )
})

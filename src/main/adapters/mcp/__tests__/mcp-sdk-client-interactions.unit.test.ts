import {
  Client,
  InMemoryTransport,
  StreamableHTTPClientTransport,
} from '@modelcontextprotocol/client'
import { createMcpHandler, inputRequired, McpServer } from '@modelcontextprotocol/server'
import type { McpTurnSnapshot, McpTurnSnapshotServer } from '@shared/types/mcp'
import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import type { McpRuntimeInteractions } from '../../../ports/mcp-runtime-service'
import { getMcpProtocolOptions } from '../runtime/protocol-negotiation'
import { createMcpInteractionController } from '../runtime/sdk-client-interactions'

function snapshot(server: McpTurnSnapshotServer): McpTurnSnapshot {
  return {
    id: 'turn-1',
    sessionId: 'session-1',
    projectPath: '/workspace/project',
    revision: 'revision-1',
    createdAt: 1,
    effectiveState: 'on',
    servers: [server],
  }
}

function serverDefinition(
  definition: McpTurnSnapshotServer['definition'],
  readRoots: readonly string[] = ['.'],
): McpTurnSnapshotServer {
  return {
    instanceId: 'fixture-server',
    name: 'Fixture server',
    sourcePath: '/workspace/project/.mcp.json',
    configHash: 'fixture-config',
    allowUnsandboxed: false,
    permissions: { readRoots, writeRoots: [], allowNetwork: false },
    definition,
  }
}

function interactions(): McpRuntimeInteractions {
  return {
    elicit: vi.fn<McpRuntimeInteractions['elicit']>(async () => ({
      action: 'accept',
      content: { confirmed: true },
    })),
    sample: vi.fn<McpRuntimeInteractions['sample']>(async () => ({
      model: 'openwaggle/fixture',
      role: 'assistant',
      content: { type: 'text', text: 'sampled' },
      stopReason: 'endTurn',
    })),
  }
}

describe('MCP SDK client interactions', () => {
  it('fulfils modern input_required rounds through the reviewed elicitation handler', async () => {
    const handler = createMcpHandler(() => {
      const server = new McpServer({ name: 'modern-fixture', version: '1.0.0' })
      server.registerTool(
        'reviewed-action',
        { inputSchema: z.object({}) },
        async (_arguments, ctx) => {
          if (!ctx.mcpReq.inputResponses?.review) {
            return inputRequired({
              inputRequests: {
                review: inputRequired.elicit({
                  message: 'Confirm the fixture action',
                  requestedSchema: {
                    type: 'object',
                    properties: { confirmed: { type: 'boolean' } },
                    required: ['confirmed'],
                  },
                }),
              },
            })
          }
          return { content: [{ type: 'text', text: 'completed after review' }] }
        },
      )
      return server
    })
    const definition = serverDefinition({ command: 'fixture', protocolVersion: '2026-07-28' })
    const client = new Client(
      { name: 'OpenWaggle interaction fixture', version: '1.0.0' },
      {
        capabilities: {},
        inputRequired: { autoFulfill: true, maxRounds: 4 },
        ...getMcpProtocolOptions(definition),
      },
    )
    const controller = createMcpInteractionController({
      client,
      snapshot: snapshot(definition),
      server: definition,
    })
    const reviewed = interactions()
    const clientTransport = new StreamableHTTPClientTransport(
      new URL('https://fixture.openwaggle.local/mcp'),
      { fetch: (url, init) => handler.fetch(new Request(url, init)) },
    )

    try {
      await client.connect(clientTransport)
      const result = await controller.run(reviewed, () =>
        client.callTool({ name: 'reviewed-action', arguments: {} }),
      )

      expect(result.content).toEqual([{ type: 'text', text: 'completed after review' }])
      expect(reviewed.elicit).toHaveBeenCalledWith(
        expect.objectContaining({
          serverInstanceId: 'fixture-server',
          request: expect.objectContaining({ message: 'Confirm the fixture action' }),
        }),
      )
    } finally {
      await client.close()
      await handler.close()
    }
  })

  it('serves legacy sampling and read-only roots only while a reviewed call is active', async () => {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    const fixtureServer = new McpServer({ name: 'legacy-fixture', version: '1.0.0' })
    await fixtureServer.connect(serverTransport)
    const definition = serverDefinition(
      {
        command: 'fixture',
        protocolVersion: '2025-11-25',
        security: { readRoots: ['docs'] },
        clientCapabilities: { sampling: true },
      },
      ['docs'],
    )
    const client = new Client(
      { name: 'OpenWaggle legacy fixture', version: '1.0.0' },
      { capabilities: {}, ...getMcpProtocolOptions(definition) },
    )
    const controller = createMcpInteractionController({
      client,
      snapshot: snapshot(definition),
      server: definition,
    })
    const reviewed = interactions()

    try {
      await client.connect(clientTransport)
      const [sample, roots] = await controller.run(reviewed, () =>
        Promise.all([
          fixtureServer.server.request({
            method: 'sampling/createMessage',
            params: {
              messages: [{ role: 'user', content: { type: 'text', text: 'hello' } }],
              maxTokens: 10,
            },
          }),
          fixtureServer.server.request({ method: 'roots/list' }),
        ]),
      )

      expect(sample).toMatchObject({ model: 'openwaggle/fixture', role: 'assistant' })
      expect(roots.roots).toEqual([{ uri: 'file:///workspace/project/docs', name: 'docs' }])
      expect(reviewed.sample).toHaveBeenCalledTimes(1)
      await expect(
        fixtureServer.server.request({
          method: 'sampling/createMessage',
          params: {
            messages: [{ role: 'user', content: { type: 'text', text: 'unsolicited' } }],
            maxTokens: 10,
          },
        }),
      ).rejects.toThrow('no trusted interaction UI')
    } finally {
      await client.close()
      await fixtureServer.close()
    }
  })
})

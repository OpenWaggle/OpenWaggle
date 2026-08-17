import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import { McpServer } from '@modelcontextprotocol/server'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { getMcpProtocolOptions } from '../adapters/mcp/runtime/protocol-negotiation'
import { serveDualEraMcpLoopbackHttp } from '../mcp-server-http'

const TOKEN = 'openwaggle-loopback-fixture-token-with-more-than-32-bytes'

function server() {
  const fixture = new McpServer({ name: 'loopback-fixture', version: '1.0.0' })
  fixture.registerTool('echo', { inputSchema: z.object({ text: z.string() }) }, ({ text }) => ({
    content: [{ type: 'text', text }],
  }))
  return fixture
}

async function connect(url: string, protocolVersion: '2026-07-28' | '2025-11-25') {
  const definition = {
    instanceId: `fixture-${protocolVersion}`,
    name: 'loopback-fixture',
    sourcePath: '/fixture/.mcp.json',
    configHash: 'fixture-hash',
    allowUnsandboxed: false,
    permissions: { readRoots: ['.'], writeRoots: [], allowNetwork: false },
    definition: { url, transport: 'streamable-http' as const, protocolVersion },
  }
  const client = new Client(
    { name: `fixture-${protocolVersion}`, version: '1.0.0' },
    getMcpProtocolOptions(definition),
  )
  const transport = new StreamableHTTPClientTransport(new URL(url), {
    requestInit: { headers: { Authorization: `Bearer ${TOKEN}` } },
  })
  await client.connect(transport)
  return client
}

describe('OpenWaggle loopback Streamable HTTP server', () => {
  it('requires bearer authentication and serves modern and legacy MCP from one factory', async () => {
    const handle = await serveDualEraMcpLoopbackHttp({
      factory: server,
      port: 0,
      bearerToken: TOKEN,
    })
    try {
      await expect(fetch(handle.url, { method: 'POST' })).resolves.toMatchObject({ status: 401 })

      for (const protocolVersion of ['2026-07-28', '2025-11-25'] as const) {
        const client = await connect(handle.url, protocolVersion)
        try {
          await expect(client.listTools()).resolves.toMatchObject({
            tools: [expect.objectContaining({ name: 'echo' })],
          })
          expect(client.getNegotiatedProtocolVersion()).toBe(protocolVersion)
        } finally {
          await client.close()
        }
      }
    } finally {
      await handle.close()
    }
  })
})

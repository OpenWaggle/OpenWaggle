import { Client, InMemoryTransport } from '@modelcontextprotocol/client'
import { McpServer } from '@modelcontextprotocol/server'
import { afterEach, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { serveDualEraMcpStdio } from '../mcp-server-stdio'

const handles: Array<{ close(): Promise<void> }> = []
const clients: Client[] = []

afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.close()))
  await Promise.all(handles.splice(0).map((handle) => handle.close()))
})

function serverFactory() {
  const server = new McpServer({ name: 'dual-era-fixture', version: '1.0.0' })
  server.registerTool('echo', { inputSchema: z.object({ text: z.string() }) }, ({ text }) => ({
    content: [{ type: 'text', text }],
  }))
  return server
}

async function connect(input: {
  readonly versions: readonly string[]
  readonly mode: 'legacy' | { readonly pin: string }
}) {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  handles.push(serveDualEraMcpStdio(serverFactory, { transport: serverTransport }))
  const client = new Client(
    { name: 'compatibility-fixture', version: '1.0.0' },
    {
      capabilities: {},
      supportedProtocolVersions: [...input.versions],
      versionNegotiation: { mode: input.mode },
    },
  )
  clients.push(client)
  await client.connect(clientTransport)
  return client
}

describe('OpenWaggle MCP stdio protocol compatibility', () => {
  it('serves the current 2026 protocol through modern discovery', async () => {
    const client = await connect({ versions: ['2026-07-28'], mode: { pin: '2026-07-28' } })

    expect(client.getProtocolEra()).toBe('modern')
    expect(client.getNegotiatedProtocolVersion()).toBe('2026-07-28')
    expect((await client.listTools()).tools.map((tool) => tool.name)).toEqual(['echo'])
  })

  it.each([
    '2025-11-25',
    '2025-06-18',
    '2025-03-26',
    '2024-11-05',
    '2024-10-07',
  ])('serves legacy initialize clients using %s', async (version) => {
    const client = await connect({ versions: [version], mode: 'legacy' })

    expect(client.getProtocolEra()).toBe('legacy')
    expect(client.getNegotiatedProtocolVersion()).toBe(version)
    expect((await client.listTools()).tools.map((tool) => tool.name)).toEqual(['echo'])
  })
})

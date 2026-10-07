import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { AuthProvider } from '@earendil-works/pi-mcp'
import { McpClient } from '@earendil-works/pi-mcp'
import { afterEach, describe, expect, it } from 'vitest'
import { McpSessionConnectionPool } from '../../../mcp/pool/mcp-session-connection-pool'
import { openPiMcpUpstream } from '../pi-mcp-upstream'

/** A legacy HTTP+SSE MCP server that wants `Authorization: Bearer good` on every request. */
function legacySseServer() {
  const streams: ServerResponse[] = []
  const seen: string[] = []
  const authorized = (request: IncomingMessage, response: ServerResponse) => {
    seen.push(request.headers.authorization ?? '')
    if (request.headers.authorization === 'Bearer good') return true
    response.writeHead(401, { 'WWW-Authenticate': 'Bearer realm="mcp"' }).end()
    return false
  }
  const answer = (message: { id?: number; method: string }) => {
    if (message.id === undefined) return
    const result =
      message.method === 'initialize'
        ? {
            protocolVersion: '2024-11-05',
            capabilities: { tools: {} },
            serverInfo: { name: 'sse', version: '1' },
          }
        : { tools: [{ name: 'echo', inputSchema: { type: 'object' } }] }
    const event = JSON.stringify({ jsonrpc: '2.0', id: message.id, result })
    for (const stream of streams) stream.write(`event: message\ndata: ${event}\n\n`)
  }
  const server = createServer((request, response) => {
    if (!authorized(request, response)) return
    if (request.method === 'GET') {
      response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' })
      response.write('event: endpoint\ndata: /messages\n\n')
      streams.push(response)
      return
    }
    let body = ''
    request.on('data', (chunk: Buffer) => {
      body += chunk.toString()
    })
    request.on('end', () => {
      response.writeHead(202).end()
      answer(JSON.parse(body))
    })
  })
  return { server, seen, streams }
}

const servers: Server[] = []
const pools: McpSessionConnectionPool[] = []

afterEach(async () => {
  await Promise.all(pools.splice(0).map((pool) => pool.closeAll()))
  for (const server of servers.splice(0)) server.closeAllConnections()
  await Promise.all(servers.map((server) => new Promise((resolve) => server.close(resolve))))
})

async function listen() {
  const fixture = legacySseServer()
  servers.push(fixture.server)
  await new Promise<void>((resolve) => fixture.server.listen(0, '127.0.0.1', resolve))
  const { port } = fixture.server.address() as AddressInfo
  return { ...fixture, url: `http://127.0.0.1:${String(port)}/sse` }
}

async function connect(url: string, authProvider: AuthProvider) {
  const pool = new McpSessionConnectionPool()
  pools.push(pool)
  const entry = { name: 'sse', config: { url }, source: 'test' }
  const lease = pool.lease('s1', {
    name: 'sse',
    fingerprint: 'v1',
    open: () => openPiMcpUpstream({ entry, transport: 'sse', cwd: process.cwd(), authProvider }),
  })
  const client = new McpClient({ name: 'pi', version: '1' })
  await client.connect(lease)
  return client
}

describe('legacy SSE servers that need a sign-in, through the pool', () => {
  it("sends the sign-in's bearer token on the event stream and on every message", async () => {
    const fixture = await listen()

    const client = await connect(fixture.url, { token: async () => 'good' })
    const tools = await client.listTools()

    expect(tools.map((tool) => tool.name)).toEqual(['echo'])
    expect(new Set(fixture.seen)).toEqual(new Set(['Bearer good']))
    await client.close()
  })

  it('lets the auth provider refresh after a 401 and retries with the new token', async () => {
    const fixture = await listen()
    let token = 'expired'
    let refreshes = 0

    const client = await connect(fixture.url, {
      token: async () => token,
      onUnauthorized: async (context) => {
        expect(context.token).toBe('expired')
        refreshes += 1
        token = 'good'
      },
    })

    await expect(client.listTools()).resolves.toHaveLength(1)
    expect(refreshes).toBe(1)
    await client.close()
  })

  it('fails with McpAuthRequiredError when the server still refuses, so Pi asks for a sign-in', async () => {
    const fixture = await listen()

    const failure = await connect(fixture.url, { token: async () => 'revoked' }).catch(
      (error: unknown) => error,
    )

    expect(failure).toBeInstanceOf(Error)
    expect(failure).toMatchObject({ name: 'McpAuthRequiredError' })
  })
})

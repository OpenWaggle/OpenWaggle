import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AuthProvider } from '@earendil-works/pi-mcp'
import { McpClient } from '@earendil-works/pi-mcp'
import { afterEach, describe, expect, it } from 'vitest'
import { WebSocketServer } from 'ws'
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
const socketServers: WebSocketServer[] = []
const pools: McpSessionConnectionPool[] = []

afterEach(async () => {
  await Promise.all(pools.splice(0).map((pool) => pool.closeAll()))
  await Promise.all(
    socketServers.splice(0).map((server) => new Promise((resolve) => server.close(resolve))),
  )
  for (const server of servers.splice(0)) server.closeAllConnections()
  await Promise.all(servers.map((server) => new Promise((resolve) => server.close(resolve))))
})

async function listen() {
  const fixture = legacySseServer()
  servers.push(fixture.server)
  await new Promise<void>((resolve) => fixture.server.listen(0, '127.0.0.1', resolve))
  const address = fixture.server.address()
  const port = typeof address === 'object' && address ? address.port : 0
  return { ...fixture, url: `http://127.0.0.1:${String(port)}/sse` }
}

async function connect(
  url: string,
  authProvider: AuthProvider | undefined,
  transport: 'sse' | 'websocket' = 'sse',
) {
  const pool = new McpSessionConnectionPool()
  pools.push(pool)
  const entry = { name: transport, config: { url }, source: 'test' }
  const lease = pool.lease('s1', {
    name: transport,
    fingerprint: 'v1',
    open: () => openPiMcpUpstream({ entry, transport, cwd: process.cwd(), authProvider }),
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

/** A legacy WebSocket MCP server: JSON-RPC messages as text frames. */
async function webSocketServer() {
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0 })
  socketServers.push(server)
  server.on('connection', (socket) => {
    socket.on('message', (data) => {
      const message: { id?: number; method: string } = JSON.parse(data.toString())
      if (message.id === undefined) return
      const result =
        message.method === 'initialize'
          ? {
              protocolVersion: '2024-11-05',
              capabilities: { tools: {} },
              serverInfo: { name: 'ws', version: '1' },
            }
          : { tools: [{ name: 'ping', inputSchema: { type: 'object' } }] }
      socket.send(JSON.stringify({ jsonrpc: '2.0', id: message.id, result }))
    })
  })
  await new Promise<void>((resolve) => server.once('listening', resolve))
  const address = server.address()
  return `ws://127.0.0.1:${String(typeof address === 'object' && address ? address.port : 0)}/mcp`
}

describe('legacy WebSocket servers, through the pool', () => {
  it('connects and lists tools', async () => {
    const url = await webSocketServer()

    const first = await connect(url, undefined, 'websocket')
    await expect(first.listTools()).resolves.toEqual([expect.objectContaining({ name: 'ping' })])
    await first.close()
  })
})

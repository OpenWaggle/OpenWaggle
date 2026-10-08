import { afterEach, describe, expect, it } from 'vitest'
import { WebSocketServer } from 'ws'
import { LegacyWebSocketClientTransport } from '../runtime/websocket-transport'

const servers: WebSocketServer[] = []

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map((server) => new Promise((resolve) => server.close(resolve))),
  )
})

async function listen() {
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0 })
  servers.push(server)
  await new Promise<void>((resolve) => server.once('listening', resolve))
  const address = server.address()
  return typeof address === 'object' && address ? address.port : 0
}

/** `lan.example` stands for a server on the local network: it resolves to a private address. */
const lanResolver = async () => [{ address: '127.0.0.1', family: 4 }]

describe('the legacy WebSocket transport to a server the user configured', () => {
  it('connects over plain ws:// to a host on the local network, as HTTP servers may', async () => {
    const port = await listen()
    const transport = new LegacyWebSocketClientTransport({
      url: new URL(`ws://lan.example:${String(port)}/mcp`),
      headers: {},
      allowInsecurePrivateNetwork: true,
      allowPlainWebSocket: true,
      resolveHostname: lanResolver,
    })

    await expect(transport.start()).resolves.toBeUndefined()
    await transport.close()
  })

  it('still refuses plain ws:// and private addresses unless they are allowed', async () => {
    const port = await listen()
    const transport = new LegacyWebSocketClientTransport({
      url: new URL(`ws://lan.example:${String(port)}/mcp`),
      headers: {},
      resolveHostname: lanResolver,
    })

    await expect(transport.start()).rejects.toThrow()
  })

  it('receives a message as large as the other transports allow, above 1 MB', async () => {
    const port = await listen()
    const large = 'x'.repeat(2 * 1024 * 1024)
    servers[0]?.on('connection', (socket) => {
      socket.send(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { text: large } }))
    })
    const transport = new LegacyWebSocketClientTransport({
      url: new URL(`ws://lan.example:${String(port)}/mcp`),
      headers: {},
      allowInsecurePrivateNetwork: true,
      allowPlainWebSocket: true,
      resolveHostname: lanResolver,
    })
    const received = new Promise<unknown>((resolve, reject) => {
      transport.onmessage = resolve
      transport.onerror = reject
    })

    await transport.start()

    await expect(received).resolves.toMatchObject({ id: 1, result: { text: large } })
    await transport.close()
  })
})

import { createServer, type Server, type Socket } from 'node:net'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createMcpServerFetch, MCP_FETCH_CLOSE_GRACE_MS } from '../mcp-server-fetch'

const SERVER = 'https://mcp.internal.example:8443/mcp'
const PRIVATE_TOKEN_ENDPOINT = 'https://10.20.30.40/realms/x/protocol/openid-connect/token'
const PLAIN_TOKEN_ENDPOINT = 'http://10.20.30.40/realms/x/protocol/openid-connect/token'
const NETWORK_REFUSAL = /private|forbidden|not allowed|require/i
const CLOSE_MARGIN_MS = 1_000

/** Stands in for the network: a request that passes the checks is answered here, not sent. */
function answered() {
  return vi.fn(async () => new Response('{}', { status: 200 }))
}

async function failureOf(fetch: ReturnType<typeof createMcpServerFetch>, url: string) {
  const outcome = await fetch(url, { method: 'POST' }).then(
    () => 'sent',
    (caught: unknown) => (caught instanceof Error ? caught.message : String(caught)),
  )
  await fetch.close()
  return outcome
}

let server: Server | undefined
const sockets = new Set<Socket>()

afterEach(async () => {
  for (const socket of sockets) socket.destroy()
  sockets.clear()
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()))
  server = undefined
})

describe("the fetch of an MCP server's HTTP transport", () => {
  it('refuses a private-network host that is neither the server nor its authorization server', async () => {
    const network = answered()

    const outcome = await failureOf(
      createMcpServerFetch(SERVER, { fetchFn: network }),
      PRIVATE_TOKEN_ENDPOINT,
    )

    expect(outcome).toMatch(NETWORK_REFUSAL)
    expect(network).not.toHaveBeenCalled()
  })

  it.each([
    [
      'configured',
      { authServerMetadataUrl: 'https://10.20.30.40/realms/x/.well-known/openid-configuration' },
    ],
    ['discovered', { discovered: ['https://10.20.30.40/realms/x'] }],
  ])(
    'reaches a private-network authorization server the user %s, also over plain http',
    async (_how, hosts) => {
      const authorizationServers = () => [
        ...('authServerMetadataUrl' in hosts ? [hosts.authServerMetadataUrl] : []),
        ...('discovered' in hosts ? hosts.discovered : []),
      ]

      for (const url of [PRIVATE_TOKEN_ENDPOINT, PLAIN_TOKEN_ENDPOINT]) {
        const network = answered()
        const fetch = createMcpServerFetch(SERVER, { authorizationServers, fetchFn: network })
        expect(await failureOf(fetch, url)).toBe('sent')
        expect(network).toHaveBeenCalledWith(
          new URL(url),
          expect.anything(),
          expect.objectContaining({ address: '10.20.30.40' }),
        )
      }
    },
  )

  it('closes without waiting out a connection that never answers', async () => {
    // Accepts the connection and never answers the TLS handshake, like a stuck network.
    server = createServer((socket) => sockets.add(socket))
    await new Promise<void>((resolve) => server?.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    const port = typeof address === 'object' && address ? address.port : 0
    const fetch = createMcpServerFetch(`https://127.0.0.1:${String(port)}/mcp`)
    const request = fetch(`https://127.0.0.1:${String(port)}/mcp`, { method: 'POST' }).catch(
      () => 'failed',
    )
    await vi.waitFor(() => expect(sockets.size).toBe(1))

    const started = Date.now()
    await fetch.close()

    expect(Date.now() - started).toBeLessThan(MCP_FETCH_CLOSE_GRACE_MS + CLOSE_MARGIN_MS)
    await expect(request).resolves.toBe('failed')
    // The request is ended with the close, not by the connect timeout (10 s).
    expect(Date.now() - started).toBeLessThan(MCP_FETCH_CLOSE_GRACE_MS + CLOSE_MARGIN_MS)
  })
})

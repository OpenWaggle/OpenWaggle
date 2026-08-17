import { createHash, timingSafeEqual } from 'node:crypto'
import { createServer } from 'node:http'
import { toNodeHandler } from '@modelcontextprotocol/node'
import {
  createMcpHandler,
  hostHeaderValidationResponse,
  localhostAllowedHostnames,
  localhostAllowedOrigins,
  type McpServerFactory,
  originValidationResponse,
} from '@modelcontextprotocol/server'

const LOOPBACK_HOST = '127.0.0.1'
const MCP_PATH = '/mcp'
const MIN_BEARER_TOKEN_BYTES = 32
const MAX_TCP_PORT = 65_535
const HTTP_NOT_FOUND = 404
const HTTP_UNAUTHORIZED = 401
const HTTP_INTERNAL_SERVER_ERROR = 500

function digest(value: string) {
  return createHash('sha256').update(value).digest()
}

function authorized(request: Request, expectedDigest: Buffer) {
  const header = request.headers.get('authorization')
  if (!header?.startsWith('Bearer ')) return false
  const received = digest(header.slice('Bearer '.length))
  return (
    received.byteLength === expectedDigest.byteLength && timingSafeEqual(received, expectedDigest)
  )
}

export async function serveDualEraMcpLoopbackHttp(input: {
  readonly factory: McpServerFactory
  readonly port: number
  readonly bearerToken: string
  readonly onerror?: (error: Error) => void
  readonly maxSubscriptions?: number
}) {
  if (Buffer.byteLength(input.bearerToken) < MIN_BEARER_TOKEN_BYTES) {
    throw new Error('Loopback MCP bearer tokens must contain at least 32 bytes.')
  }
  if (!Number.isInteger(input.port) || input.port < 0 || input.port > MAX_TCP_PORT) {
    throw new Error('Loopback MCP port must be an integer from 0 through 65535.')
  }
  const expectedDigest = digest(input.bearerToken)
  const handler = createMcpHandler(input.factory, {
    legacy: 'stateless',
    ...(input.maxSubscriptions === undefined ? {} : { maxSubscriptions: input.maxSubscriptions }),
    ...(input.onerror ? { onerror: input.onerror } : {}),
  })
  const authenticatedHandler = {
    fetch: async (request: Request) => {
      if (new URL(request.url).pathname !== MCP_PATH) {
        return new Response('Not found.', { status: HTTP_NOT_FOUND })
      }
      const rejected =
        hostHeaderValidationResponse(request, localhostAllowedHostnames()) ??
        originValidationResponse(request, localhostAllowedOrigins())
      if (rejected) return rejected
      if (!authorized(request, expectedDigest)) {
        return new Response('Bearer authentication required.', {
          status: HTTP_UNAUTHORIZED,
          headers: { 'WWW-Authenticate': 'Bearer' },
        })
      }
      return handler.fetch(request, {
        authInfo: {
          token: 'redacted',
          clientId: 'openwaggle-loopback-client',
          scopes: ['openwaggle:mcp'],
        },
      })
    },
  }
  const nodeHandler = toNodeHandler(authenticatedHandler, {
    ...(input.onerror ? { onerror: input.onerror } : {}),
  })
  const server = createServer((request, response) => {
    void nodeHandler(request, response).catch((error: unknown) => {
      input.onerror?.(error instanceof Error ? error : new Error(String(error)))
      if (!response.headersSent) response.writeHead(HTTP_INTERNAL_SERVER_ERROR)
      response.end('Internal server error.')
    })
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(input.port, LOOPBACK_HOST, resolve)
  })
  const address = server.address()
  if (!address || typeof address === 'string') {
    server.close()
    await handler.close()
    throw new Error('Loopback MCP server did not expose a TCP address.')
  }
  let closed = false
  return {
    url: `http://${LOOPBACK_HOST}:${String(address.port)}${MCP_PATH}`,
    close: async () => {
      if (closed) return
      closed = true
      await Promise.all([
        handler.close(),
        new Promise<void>((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve())),
        ),
      ])
    },
  }
}

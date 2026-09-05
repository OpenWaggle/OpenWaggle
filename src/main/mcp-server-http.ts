import { createHash, timingSafeEqual } from 'node:crypto'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { toNodeHandler } from '@modelcontextprotocol/node'
import {
  createMcpHandler,
  hostHeaderValidationResponse,
  localhostAllowedHostnames,
  localhostAllowedOrigins,
  type McpServerFactory,
  originValidationResponse,
  validateHostHeader,
  validateOriginHeader,
} from '@modelcontextprotocol/server'

const LOOPBACK_HOST = '127.0.0.1'
const MCP_PATH = '/mcp'
const MIN_BEARER_TOKEN_BYTES = 32
const MAX_TCP_PORT = 65_535
const DEFAULT_MAX_REQUEST_BODY_BYTES = 64 * 1024 * 1024
const HTTP_BAD_REQUEST = 400
const HTTP_NOT_FOUND = 404
const HTTP_UNAUTHORIZED = 401
const HTTP_FORBIDDEN = 403
const HTTP_PAYLOAD_TOO_LARGE = 413
const HTTP_INTERNAL_SERVER_ERROR = 500

function digest(value: string) {
  return createHash('sha256').update(value).digest()
}

function authorized(request: Request, expectedDigest: Buffer) {
  return authorizedHeader(request.headers.get('authorization') ?? undefined, expectedDigest)
}

function authorizedHeader(header: string | undefined, expectedDigest: Buffer) {
  if (!header?.startsWith('Bearer ')) return false
  const received = digest(header.slice('Bearer '.length))
  return (
    received.byteLength === expectedDigest.byteLength && timingSafeEqual(received, expectedDigest)
  )
}

function firstHeaderValue(value: string | string[] | undefined): string | undefined {
  if (typeof value === 'string') return value
  return value?.[0]
}

function requestPath(request: IncomingMessage) {
  return new URL(request.url ?? '/', 'http://localhost').pathname
}

function rejectRawRequest(
  request: IncomingMessage,
  response: ServerResponse,
  status: number,
  message: string,
  headers: Readonly<Record<string, string>> = {},
) {
  response.shouldKeepAlive = false
  response.writeHead(status, {
    Connection: 'close',
    'Content-Type': 'text/plain; charset=utf-8',
    ...headers,
  })
  response.end(message, () => request.destroy())
}

function validateRawRequest(
  request: IncomingMessage,
  response: ServerResponse,
  expectedDigest: Buffer,
  maxRequestBodyBytes: number,
) {
  if (requestPath(request) !== MCP_PATH) {
    rejectRawRequest(request, response, HTTP_NOT_FOUND, 'Not found.')
    return false
  }

  const host = validateHostHeader(
    firstHeaderValue(request.headers.host),
    localhostAllowedHostnames(),
  )
  if (!host.ok) {
    rejectRawRequest(request, response, HTTP_FORBIDDEN, host.message)
    return false
  }

  const origin = validateOriginHeader(
    firstHeaderValue(request.headers.origin),
    localhostAllowedOrigins(),
  )
  if (!origin.ok) {
    rejectRawRequest(request, response, HTTP_FORBIDDEN, origin.message)
    return false
  }

  if (!authorizedHeader(firstHeaderValue(request.headers.authorization), expectedDigest)) {
    rejectRawRequest(request, response, HTTP_UNAUTHORIZED, 'Bearer authentication required.', {
      'WWW-Authenticate': 'Bearer',
    })
    return false
  }

  const contentLength = firstHeaderValue(request.headers['content-length'])
  if (contentLength !== undefined) {
    if (!/^\d+$/.test(contentLength)) {
      rejectRawRequest(request, response, HTTP_BAD_REQUEST, 'Invalid Content-Length header.')
      return false
    }
    if (Number(contentLength) > maxRequestBodyBytes) {
      rejectRawRequest(request, response, HTTP_PAYLOAD_TOO_LARGE, 'Request body is too large.')
      return false
    }
  }
  return true
}

class McpHttpRequestBodyTooLargeError extends Error {
  constructor() {
    super('Request body is too large.')
    this.name = 'McpHttpRequestBodyTooLargeError'
  }
}

async function readBoundedRequestBody(request: IncomingMessage, maxRequestBodyBytes: number) {
  const method = (request.method ?? 'GET').toUpperCase()
  if (method === 'GET' || method === 'HEAD') return undefined

  const chunks: Buffer[] = []
  let bytes = 0
  for await (const rawChunk of request) {
    const chunk: unknown = rawChunk
    const buffer =
      typeof chunk === 'string'
        ? Buffer.from(chunk)
        : Buffer.isBuffer(chunk)
          ? chunk
          : (() => {
              throw new Error('Request body contained an unsupported chunk type.')
            })()
    bytes += buffer.byteLength
    if (bytes > maxRequestBodyBytes) throw new McpHttpRequestBodyTooLargeError()
    chunks.push(buffer)
  }
  if (bytes === 0) return undefined

  const raw = Buffer.concat(chunks, bytes).toString('utf8')
  try {
    const parsed: unknown = JSON.parse(raw)
    return parsed
  } catch {
    return raw
  }
}

export async function serveDualEraMcpLoopbackHttp(input: {
  readonly factory: McpServerFactory
  readonly port: number
  readonly bearerToken: string
  readonly onerror?: (error: Error) => void
  readonly maxSubscriptions?: number
  readonly maxRequestBodyBytes?: number
}) {
  if (Buffer.byteLength(input.bearerToken) < MIN_BEARER_TOKEN_BYTES) {
    throw new Error('Loopback MCP bearer tokens must contain at least 32 bytes.')
  }
  if (!Number.isInteger(input.port) || input.port < 0 || input.port > MAX_TCP_PORT) {
    throw new Error('Loopback MCP port must be an integer from 0 through 65535.')
  }
  const maxRequestBodyBytes = input.maxRequestBodyBytes ?? DEFAULT_MAX_REQUEST_BODY_BYTES
  if (
    !Number.isInteger(maxRequestBodyBytes) ||
    maxRequestBodyBytes <= 0 ||
    maxRequestBodyBytes > DEFAULT_MAX_REQUEST_BODY_BYTES
  ) {
    throw new Error(
      `Loopback MCP request body limit must be a positive integer no greater than ${String(DEFAULT_MAX_REQUEST_BODY_BYTES)}.`,
    )
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
    if (!validateRawRequest(request, response, expectedDigest, maxRequestBodyBytes)) return
    void readBoundedRequestBody(request, maxRequestBodyBytes)
      .then((parsedBody) => nodeHandler(request, response, parsedBody))
      .catch((error: unknown) => {
        if (error instanceof McpHttpRequestBodyTooLargeError) {
          rejectRawRequest(request, response, HTTP_PAYLOAD_TOO_LARGE, 'Request body is too large.')
          return
        }
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

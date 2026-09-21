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
import {
  McpHttpRequestBodyCapacityError,
  type McpHttpRequestBodyOptions,
  McpHttpRequestBodyTimeoutError,
  McpHttpRequestBodyTooLargeError,
  makeMcpHttpRequestBodyAdmission,
  readMcpHttpRequestBody,
  resolveMcpHttpRequestBodyPolicy,
} from './mcp-server-http-request-body'

const LOOPBACK_HOST = '127.0.0.1'
const MCP_PATH = '/mcp'
const MIN_BEARER_TOKEN_BYTES = 32
const MAX_TCP_PORT = 65_535
const HTTP_BAD_REQUEST = 400
const HTTP_NOT_FOUND = 404
const HTTP_UNAUTHORIZED = 401
const HTTP_FORBIDDEN = 403
const HTTP_PAYLOAD_TOO_LARGE = 413
const HTTP_REQUEST_TIMEOUT = 408
const HTTP_TOO_MANY_REQUESTS = 429
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
  try {
    return new URL(request.url ?? '/', 'http://localhost').pathname
  } catch {
    return undefined
  }
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
): { readonly declaredBodyBytes?: number } | undefined {
  const path = requestPath(request)
  if (path === undefined) {
    rejectRawRequest(request, response, HTTP_BAD_REQUEST, 'Invalid request target.')
    return undefined
  }
  if (path !== MCP_PATH) {
    rejectRawRequest(request, response, HTTP_NOT_FOUND, 'Not found.')
    return undefined
  }

  const host = validateHostHeader(
    firstHeaderValue(request.headers.host),
    localhostAllowedHostnames(),
  )
  if (!host.ok) {
    rejectRawRequest(request, response, HTTP_FORBIDDEN, host.message)
    return undefined
  }

  const origin = validateOriginHeader(
    firstHeaderValue(request.headers.origin),
    localhostAllowedOrigins(),
  )
  if (!origin.ok) {
    rejectRawRequest(request, response, HTTP_FORBIDDEN, origin.message)
    return undefined
  }

  if (!authorizedHeader(firstHeaderValue(request.headers.authorization), expectedDigest)) {
    rejectRawRequest(request, response, HTTP_UNAUTHORIZED, 'Bearer authentication required.', {
      'WWW-Authenticate': 'Bearer',
    })
    return undefined
  }

  const contentLength = firstHeaderValue(request.headers['content-length'])
  if (contentLength !== undefined) {
    if (!/^\d+$/.test(contentLength)) {
      rejectRawRequest(request, response, HTTP_BAD_REQUEST, 'Invalid Content-Length header.')
      return undefined
    }
    if (Number(contentLength) > maxRequestBodyBytes) {
      rejectRawRequest(request, response, HTTP_PAYLOAD_TOO_LARGE, 'Request body is too large.')
      return undefined
    }
    return { declaredBodyBytes: Number(contentLength) }
  }
  return {}
}

function respondToRequestFailure(
  request: IncomingMessage,
  response: ServerResponse,
  error: unknown,
  onerror?: (error: Error) => void,
) {
  if (error instanceof McpHttpRequestBodyTooLargeError) {
    rejectRawRequest(request, response, HTTP_PAYLOAD_TOO_LARGE, 'Request body is too large.')
    return
  }
  if (error instanceof McpHttpRequestBodyCapacityError) {
    rejectRawRequest(
      request,
      response,
      HTTP_TOO_MANY_REQUESTS,
      'Loopback MCP request capacity is exhausted.',
      { 'Retry-After': '1' },
    )
    return
  }
  if (error instanceof McpHttpRequestBodyTimeoutError) {
    rejectRawRequest(
      request,
      response,
      HTTP_REQUEST_TIMEOUT,
      'Request body read deadline exceeded.',
    )
    return
  }
  onerror?.(error instanceof Error ? error : new Error(String(error)))
  if (!response.headersSent) response.writeHead(HTTP_INTERNAL_SERVER_ERROR)
  response.end('Internal server error.')
}

function makeLoopbackRequestListener(input: {
  readonly expectedDigest: Buffer
  readonly nodeHandler: ReturnType<typeof toNodeHandler>
  readonly bodyPolicy: ReturnType<typeof resolveMcpHttpRequestBodyPolicy>
  readonly onerror?: (error: Error) => void
}) {
  const bodyAdmission = makeMcpHttpRequestBodyAdmission({
    maxConcurrentBodies: input.bodyPolicy.maxConcurrentBodies,
    maxAggregateBytes: input.bodyPolicy.maxAggregateBytes,
  })
  return (request: IncomingMessage, response: ServerResponse) => {
    const validated = validateRawRequest(
      request,
      response,
      input.expectedDigest,
      input.bodyPolicy.maxRequestBodyBytes,
    )
    if (!validated) return
    const method = (request.method ?? 'GET').toUpperCase()
    if (method === 'GET' || method === 'HEAD') {
      void Promise.resolve()
        .then(() => input.nodeHandler(request, response, undefined))
        .catch((error: unknown) => respondToRequestFailure(request, response, error, input.onerror))
      return
    }
    const admission = bodyAdmission.acquire(validated.declaredBodyBytes)
    if (!admission.accepted) {
      rejectRawRequest(
        request,
        response,
        HTTP_TOO_MANY_REQUESTS,
        'Loopback MCP request capacity is exhausted.',
        { 'Retry-After': '1' },
      )
      return
    }
    response.once('finish', admission.lease.release)
    response.once('close', admission.lease.release)
    void readMcpHttpRequestBody({
      request,
      maxRequestBodyBytes: input.bodyPolicy.maxRequestBodyBytes,
      timeoutMs: input.bodyPolicy.timeoutMs,
      retainChunk: admission.lease.retainChunk,
    })
      .then((parsedBody) => input.nodeHandler(request, response, parsedBody))
      .catch((error: unknown) => respondToRequestFailure(request, response, error, input.onerror))
  }
}

export async function serveDualEraMcpLoopbackHttp(
  input: {
    readonly factory: McpServerFactory
    readonly port: number
    readonly bearerToken: string
    readonly onerror?: (error: Error) => void
    readonly maxSubscriptions?: number
  } & McpHttpRequestBodyOptions,
) {
  if (Buffer.byteLength(input.bearerToken) < MIN_BEARER_TOKEN_BYTES) {
    throw new Error('Loopback MCP bearer tokens must contain at least 32 bytes.')
  }
  if (!Number.isInteger(input.port) || input.port < 0 || input.port > MAX_TCP_PORT) {
    throw new Error('Loopback MCP port must be an integer from 0 through 65535.')
  }
  const bodyPolicy = resolveMcpHttpRequestBodyPolicy(input)
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
  const server = createServer(
    makeLoopbackRequestListener({
      expectedDigest,
      nodeHandler,
      bodyPolicy,
      ...(input.onerror ? { onerror: input.onerror } : {}),
    }),
  )
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

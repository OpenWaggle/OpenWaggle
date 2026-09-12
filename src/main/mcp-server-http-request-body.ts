import type { IncomingMessage } from 'node:http'

const MAX_REQUEST_BODY_BYTES = 64 * 1024 * 1024
const DEFAULT_MAX_CONCURRENT_REQUEST_BODIES = 8
const MAX_CONCURRENT_REQUEST_BODIES = 64
const DEFAULT_REQUEST_BODY_READ_TIMEOUT_MS = 15_000
const MAX_REQUEST_BODY_READ_TIMEOUT_MS = 60_000

export interface McpHttpRequestBodyOptions {
  readonly maxRequestBodyBytes?: number
  readonly maxAggregateRequestBodyBytes?: number
  readonly maxConcurrentRequestBodies?: number
  readonly requestBodyReadTimeoutMs?: number
}

function positiveIntegerAtMost(value: number, max: number, message: string) {
  if (!Number.isInteger(value) || value <= 0 || value > max) throw new Error(message)
  return value
}

export function resolveMcpHttpRequestBodyPolicy(input: McpHttpRequestBodyOptions) {
  const maxRequestBodyBytes = positiveIntegerAtMost(
    input.maxRequestBodyBytes ?? MAX_REQUEST_BODY_BYTES,
    MAX_REQUEST_BODY_BYTES,
    `Loopback MCP request body limit must be a positive integer no greater than ${String(MAX_REQUEST_BODY_BYTES)}.`,
  )
  const maxAggregateBytes = positiveIntegerAtMost(
    input.maxAggregateRequestBodyBytes ?? MAX_REQUEST_BODY_BYTES,
    MAX_REQUEST_BODY_BYTES,
    `Loopback MCP aggregate request body limit must be a positive integer no greater than ${String(MAX_REQUEST_BODY_BYTES)}.`,
  )
  const maxConcurrentBodies = positiveIntegerAtMost(
    input.maxConcurrentRequestBodies ?? DEFAULT_MAX_CONCURRENT_REQUEST_BODIES,
    MAX_CONCURRENT_REQUEST_BODIES,
    `Loopback MCP concurrent request-body limit must be an integer from 1 through ${String(MAX_CONCURRENT_REQUEST_BODIES)}.`,
  )
  const timeoutMs = positiveIntegerAtMost(
    input.requestBodyReadTimeoutMs ?? DEFAULT_REQUEST_BODY_READ_TIMEOUT_MS,
    MAX_REQUEST_BODY_READ_TIMEOUT_MS,
    `Loopback MCP request body deadline must be an integer from 1 through ${String(MAX_REQUEST_BODY_READ_TIMEOUT_MS)} milliseconds.`,
  )
  return { maxRequestBodyBytes, maxAggregateBytes, maxConcurrentBodies, timeoutMs }
}

export class McpHttpRequestBodyTooLargeError extends Error {
  constructor() {
    super('Request body is too large.')
    this.name = 'McpHttpRequestBodyTooLargeError'
  }
}

export class McpHttpRequestBodyCapacityError extends Error {
  constructor() {
    super('Loopback MCP request-body capacity is exhausted.')
    this.name = 'McpHttpRequestBodyCapacityError'
  }
}

export class McpHttpRequestBodyTimeoutError extends Error {
  constructor() {
    super('Request body read deadline exceeded.')
    this.name = 'McpHttpRequestBodyTimeoutError'
  }
}

interface RequestBodyLease {
  retainChunk(bytes: number): boolean
  release(): void
}

type AdmissionResult =
  | { readonly accepted: true; readonly lease: RequestBodyLease }
  | { readonly accepted: false; readonly reason: 'concurrency' | 'aggregate-bytes' }

export function makeMcpHttpRequestBodyAdmission(input: {
  readonly maxConcurrentBodies: number
  readonly maxAggregateBytes: number
}) {
  let activeRequests = 0
  let retainedBytes = 0
  return {
    acquire(declaredBytes: number | undefined): AdmissionResult {
      if (activeRequests >= input.maxConcurrentBodies) {
        return { accepted: false, reason: 'concurrency' }
      }
      const initialBytes = declaredBytes ?? 0
      if (retainedBytes + initialBytes > input.maxAggregateBytes) {
        return { accepted: false, reason: 'aggregate-bytes' }
      }
      activeRequests += 1
      retainedBytes += initialBytes
      let heldBytes = initialBytes
      let released = false
      return {
        accepted: true,
        lease: {
          retainChunk(bytes) {
            if (declaredBytes !== undefined) return true
            if (retainedBytes + bytes > input.maxAggregateBytes) return false
            retainedBytes += bytes
            heldBytes += bytes
            return true
          },
          release() {
            if (released) return
            released = true
            activeRequests -= 1
            retainedBytes -= heldBytes
          },
        },
      }
    },
  }
}

export function readMcpHttpRequestBody(input: {
  readonly request: IncomingMessage
  readonly maxRequestBodyBytes: number
  readonly timeoutMs: number
  readonly retainChunk: (bytes: number) => boolean
}) {
  return new Promise<unknown>((resolve, reject) => {
    const chunks: Buffer[] = []
    let bytes = 0
    let settled = false

    const cleanup = () => {
      clearTimeout(timeout)
      input.request.off('data', onData)
      input.request.off('end', onEnd)
      input.request.off('error', onError)
      input.request.off('aborted', onAborted)
    }
    const fail = (error: Error) => {
      if (settled) return
      settled = true
      input.request.pause()
      cleanup()
      reject(error)
    }
    const succeed = (value: unknown) => {
      if (settled) return
      settled = true
      cleanup()
      resolve(value)
    }
    const onData = (rawChunk: unknown) => {
      const chunk =
        typeof rawChunk === 'string'
          ? Buffer.from(rawChunk)
          : Buffer.isBuffer(rawChunk)
            ? rawChunk
            : undefined
      if (!chunk) {
        fail(new Error('Request body contained an unsupported chunk type.'))
        return
      }
      bytes += chunk.byteLength
      if (bytes > input.maxRequestBodyBytes) {
        fail(new McpHttpRequestBodyTooLargeError())
        return
      }
      if (!input.retainChunk(chunk.byteLength)) {
        fail(new McpHttpRequestBodyCapacityError())
        return
      }
      chunks.push(chunk)
    }
    const onEnd = () => {
      if (bytes === 0) {
        succeed(undefined)
        return
      }
      const raw = Buffer.concat(chunks, bytes).toString('utf8')
      try {
        const parsed: unknown = JSON.parse(raw)
        succeed(parsed)
      } catch {
        succeed(raw)
      }
    }
    const onError = (error: Error) => fail(error)
    const onAborted = () => fail(new Error('Request body stream was aborted.'))
    const timeout = setTimeout(() => fail(new McpHttpRequestBodyTimeoutError()), input.timeoutMs)
    timeout.unref()

    input.request.on('data', onData)
    input.request.once('end', onEnd)
    input.request.once('error', onError)
    input.request.once('aborted', onAborted)
  })
}

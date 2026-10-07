import type { McpConnectionLease } from './mcp-connection-lease'
import {
  isJsonRpcId,
  isRecord,
  type JsonRpcId,
  type JsonRpcResponse,
  type McpWireTransport,
} from './mcp-wire'

export interface McpUpstream {
  readonly transport: McpWireTransport
  /** Recent stderr of a stdio server, for error messages and Settings. */
  readonly stderrTail?: () => string
}

export interface McpServerRequest {
  readonly method: string
  readonly params: unknown
  readonly signal: AbortSignal
}

/** Answers a server-to-client request; `undefined` means the layer does not handle the method. */
export type McpServerRequestHandler = (request: McpServerRequest) => Promise<unknown> | undefined

export interface McpPooledConnectionOptions {
  readonly serverName: string
  readonly open: () => McpUpstream
  /** Adds OpenWaggle's client capabilities to the first `initialize`. */
  readonly augmentInitializeParams?: (params: unknown) => unknown
  readonly handleServerRequest?: McpServerRequestHandler
  /** The roots the layer answers `roots/list` with. */
  readonly roots?: () => readonly { readonly uri: string; readonly name?: string }[]
  /** Sees every successful result of a client request, such as `tools/list` for MCP Apps. */
  readonly observeResult?: (method: string, params: unknown, result: unknown) => void
  /** Replaces a successful result before the client sees it, such as repaired tool schemas. */
  readonly adaptResult?: (method: string, result: unknown) => unknown
  /** Called once the connection is closed, by whichever side. */
  readonly onClosed: () => void
}

export class McpServerError extends Error {
  constructor(
    message: string,
    readonly code: number,
    readonly data?: unknown,
  ) {
    super(message)
    this.name = 'McpServerError'
  }
}

/** Errors after which the upstream must not be reused: Pi's reconnect then opens a fresh one. */
export const DISCARDING_ERRORS = new Set([
  'McpSessionExpiredError',
  'McpAuthRequiredError',
  'McpOAuthAuthorizationRequiredError',
  'McpConnectionClosedError',
])

export const INITIALIZE = 'initialize'
export const INITIALIZED = 'notifications/initialized'
export const CANCELLED = 'notifications/cancelled'
export const PROGRESS = 'notifications/progress'
export const INTERNAL_PROTOCOL_VERSION = '2025-11-25'
export const INTERNAL_CLIENT_INFO = { name: 'openwaggle', version: '1' } as const

export type Pending =
  | {
      readonly kind: 'lease'
      readonly lease: McpConnectionLease
      readonly id: JsonRpcId
      readonly method: string
      readonly params: unknown
      readonly progressToken?: JsonRpcId
    }
  | {
      readonly kind: 'internal'
      readonly resolve: (result: unknown) => void
      readonly reject: (error: Error) => void
    }

export function errorResponse(id: JsonRpcId, code: number, message: string): JsonRpcResponse {
  return { jsonrpc: '2.0', id, error: { code, message } }
}

export function progressTokenOf(params: unknown): JsonRpcId | undefined {
  if (!isRecord(params) || !isRecord(params._meta)) return undefined
  const token = params._meta.progressToken
  return isJsonRpcId(token) ? token : undefined
}

export function withProgressToken(params: unknown, token: JsonRpcId) {
  if (!isRecord(params) || !isRecord(params._meta)) return params
  return { ...params, _meta: { ...params._meta, progressToken: token } }
}

/**
 * One server connection of one Session, shared by the Pi clients of that Session's successive
 * Runs (leases) and by OpenWaggle's own requests. It answers repeated `initialize` requests from
 * the cached handshake, numbers requests upstream so clients never collide, and keeps server
 * requests (sampling, elicitation, roots, ping) on OpenWaggle's side.
 */

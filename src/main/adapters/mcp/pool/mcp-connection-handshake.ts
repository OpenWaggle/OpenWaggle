import { isRecord } from '@shared/utils/validation'
import type { McpConnectionLease } from './mcp-connection-lease'
import {
  errorResponse,
  INITIALIZE,
  INITIALIZED,
  INTERNAL_CLIENT_INFO,
  INTERNAL_PROTOCOL_VERSION,
} from './mcp-connection-support'
import {
  JSON_RPC_ERROR_CODES,
  type JsonRpcId,
  type JsonRpcMessage,
  type JsonRpcRequest,
  toError,
} from './mcp-wire'

interface HandshakeChannel {
  /** Sends a request upstream and waits for its result. */
  readonly request: (method: string, params: unknown) => Promise<unknown>
  readonly notify: (message: JsonRpcMessage) => Promise<void>
  readonly augmentParams?: ((params: unknown) => unknown) | undefined
  readonly onProtocolVersion: (version: string) => void
}

/**
 * The one `initialize` exchange of a pooled connection. The first client's (or OpenWaggle's own)
 * `initialize` goes upstream; every later one is answered from the cached result, and
 * `notifications/initialized` is sent once.
 */
export class McpConnectionHandshake {
  /** The `initialize` params that went upstream, so a replacement upstream is initialized alike. */
  private requested: { readonly params: unknown } | undefined
  private result: { readonly value: unknown } | undefined
  private initializing: Promise<unknown> | undefined
  private initializedSent = false
  private readonly waiters = new Map<McpConnectionLease, JsonRpcId>()

  constructor(private readonly channel: HandshakeChannel) {}

  get isDone() {
    return this.result !== undefined
  }

  ensure(params: unknown) {
    if (this.result) return Promise.resolve(this.result.value)
    this.requested ??= { params }
    this.initializing ??= this.channel
      .request(INITIALIZE, this.channel.augmentParams?.(params) ?? params)
      .then(
        (value) => {
          this.result = { value }
          if (isRecord(value) && typeof value.protocolVersion === 'string') {
            this.channel.onProtocolVersion(value.protocolVersion)
          }
          return value
        },
        (error: unknown) => {
          this.initializing = undefined
          throw error
        },
      )
    return this.initializing
  }

  /** Initializes for OpenWaggle's own requests when no client has. */
  async ensureInitialized() {
    await this.ensure({
      protocolVersion: INTERNAL_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: INTERNAL_CLIENT_INFO,
    })
    await this.initialized({ jsonrpc: '2.0', method: INITIALIZED })
  }

  /**
   * Initializes a replacement upstream with the params the first one got, then sends
   * `notifications/initialized` if the first one had it. Clients keep the result they were given.
   * Only for a connection past its handshake: a replacement is asked for by a failed listing, which
   * a client sends after `initialize`, and clients' messages wait while it runs, so no `initialize`
   * is in flight to be lost.
   */
  async replay() {
    const requested = this.requested
    const wasInitialized = this.initializedSent
    this.result = undefined
    this.initializing = undefined
    this.initializedSent = false
    if (!requested) return
    await this.ensure(requested.params)
    if (wasInitialized) await this.initialized({ jsonrpc: '2.0', method: INITIALIZED })
  }

  /** A client's `notifications/initialized`, forwarded the first time only. */
  initialized(message: JsonRpcMessage) {
    if (this.initializedSent) return Promise.resolve()
    this.initializedSent = true
    return this.channel.notify(message)
  }

  /** Answers a client's `initialize` from the handshake. */
  async answer(lease: McpConnectionLease, message: JsonRpcRequest) {
    this.waiters.set(lease, message.id)
    try {
      const result = await this.ensure(message.params)
      lease.deliver({ jsonrpc: '2.0', id: message.id, result })
    } catch (error) {
      lease.deliver(
        errorResponse(message.id, JSON_RPC_ERROR_CODES.internalError, toError(error).message),
      )
    } finally {
      this.waiters.delete(lease)
    }
  }

  /** A client still waiting for its handshake learns why, stderr included, before the close. */
  fail(error: Error) {
    for (const [lease, id] of this.waiters) {
      lease.deliver(errorResponse(id, JSON_RPC_ERROR_CODES.internalError, error.message))
    }
    this.waiters.clear()
  }
}

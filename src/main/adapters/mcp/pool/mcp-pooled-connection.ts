import { McpClientRequestLedger } from './mcp-client-request-ledger'
import { McpConnectionLease } from './mcp-connection-lease'
import {
  CANCELLED,
  DISCARDING_ERRORS,
  errorResponse,
  INITIALIZE,
  INITIALIZED,
  INTERNAL_CLIENT_INFO,
  INTERNAL_PROTOCOL_VERSION,
  type McpPooledConnectionOptions,
  McpServerError,
  type McpUpstream,
  PROGRESS,
} from './mcp-connection-support'
import { McpServerRequestRouter } from './mcp-server-request-router'
import {
  isJsonRpcNotification,
  isJsonRpcRequest,
  isRecord,
  JSON_RPC_ERROR_CODES,
  type JsonRpcId,
  type JsonRpcMessage,
  type JsonRpcNotification,
  type JsonRpcRequest,
  type JsonRpcResponse,
  toError,
} from './mcp-wire'

/**
 * One server connection of one Session, shared by the Pi clients of that Session's successive
 * Runs (leases) and by OpenWaggle's own requests. It answers repeated `initialize` requests from
 * the cached handshake and numbers requests upstream so clients never collide
 * (`McpClientRequestLedger`); server requests go through `McpServerRequestRouter`.
 */
export class McpPooledConnection {
  private upstream: McpUpstream | undefined
  private starting: Promise<void> | undefined
  private initializing: Promise<unknown> | undefined
  private handshake: { readonly result: unknown } | undefined
  private initializedSent = false
  private closed = false
  private lastErrorValue: string | undefined
  private readonly ledger = new McpClientRequestLedger()
  private readonly leases = new Set<McpConnectionLease>()
  private readonly initializeWaiters = new Map<McpConnectionLease, JsonRpcId>()
  private readonly router: McpServerRequestRouter

  constructor(private readonly options: McpPooledConnectionOptions) {
    this.router = new McpServerRequestRouter({
      send: (message) => this.sendUpstream(message),
      leases: () => this.leases,
      options,
    })
  }

  get serverName() {
    return this.options.serverName
  }

  get isClosed() {
    return this.closed
  }

  /** Open and past its handshake. */
  get isReady() {
    return !this.closed && this.handshake !== undefined
  }

  get attachedLeases() {
    return this.leases.size
  }

  get lastError() {
    return this.lastErrorValue
  }

  get stderrTail() {
    return this.upstream?.stderrTail?.() ?? ''
  }

  /** A new client attaches; the connection opens on its `start()` if it is not open yet. */
  attach() {
    if (this.closed) throw this.closedConnectionError()
    const lease = new McpConnectionLease({
      start: () => this.start(),
      send: (from, message) => this.sendFromLease(from, message),
      detach: (from) => this.detachLease(from),
      setProtocolVersion: () => {},
    })
    this.leases.add(lease)
    return lease
  }

  /** An OpenWaggle request over the connection, initializing it first when no client has. */
  async request(method: string, params?: unknown, options: { signal?: AbortSignal } = {}) {
    await this.start()
    await this.ensureInitialized()
    return this.sendInternal(method, params, options.signal)
  }

  async close() {
    if (this.closed) return
    this.markClosed(new Error(`MCP server "${this.serverName}" connection closed`))
    await this.upstream?.transport.close().catch(() => undefined)
  }

  private closedConnectionError() {
    return new Error(`MCP server "${this.serverName}" connection is closed`)
  }

  private start() {
    if (this.closed) return Promise.reject(this.closedConnectionError())
    this.starting ??= this.openUpstream()
    return this.starting
  }

  private async openUpstream() {
    try {
      const upstream = this.options.open()
      this.upstream = upstream
      upstream.transport.onMessage((message) => this.handleUpstreamMessage(message))
      upstream.transport.onError((error) => {
        this.lastErrorValue = error.message
        for (const lease of this.leases) lease.deliverError(error)
      })
      upstream.transport.onClose(() => {
        this.markClosed(
          this.withStderr(new Error(`MCP server "${this.serverName}" closed the connection`)),
        )
      })
      await upstream.transport.start()
    } catch (error) {
      const failure = this.withStderr(toError(error))
      this.lastErrorValue = failure.message
      this.markClosed(failure)
      await this.upstream?.transport.close().catch(() => undefined)
      throw failure
    }
  }

  private withStderr(error: Error) {
    const stderr = this.stderrTail.trim()
    return stderr ? new Error(`${error.message}\n${stderr}`) : error
  }

  private ensureHandshake(params: unknown) {
    if (this.handshake) return Promise.resolve(this.handshake.result)
    this.initializing ??= this.sendInternal(
      INITIALIZE,
      this.options.augmentInitializeParams?.(params) ?? params,
    ).then(
      (result) => {
        this.handshake = { result }
        if (isRecord(result) && typeof result.protocolVersion === 'string') {
          this.upstream?.transport.setProtocolVersion?.(result.protocolVersion)
        }
        return result
      },
      (error: unknown) => {
        this.initializing = undefined
        throw error
      },
    )
    return this.initializing
  }

  private async ensureInitialized() {
    await this.ensureHandshake({
      protocolVersion: INTERNAL_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: INTERNAL_CLIENT_INFO,
    })
    if (this.initializedSent) return
    this.initializedSent = true
    await this.sendUpstream({ jsonrpc: '2.0', method: INITIALIZED })
  }

  private sendUpstream(message: JsonRpcMessage) {
    const upstream = this.upstream
    if (!upstream || this.closed) return Promise.reject(this.closedConnectionError())
    return upstream.transport.send(message).catch((error: unknown) => {
      const failure = toError(error)
      if (DISCARDING_ERRORS.has(failure.name)) void this.close()
      throw failure
    })
  }

  private sendInternal(method: string, params: unknown, signal?: AbortSignal) {
    const id = this.ledger.allocate()
    const response = this.ledger.waitForInternal(id, signal, () => {
      void this.sendUpstream({
        jsonrpc: '2.0',
        method: CANCELLED,
        params: { requestId: id },
      }).catch(() => undefined)
    })
    const request: JsonRpcRequest = {
      jsonrpc: '2.0',
      id,
      method,
      ...(params === undefined ? {} : { params }),
    }
    this.sendUpstream(request).catch((error: unknown) => {
      this.ledger.rejectRequest(id, toError(error))
    })
    return response
  }

  private async sendFromLease(lease: McpConnectionLease, message: JsonRpcMessage) {
    if (isJsonRpcRequest(message)) {
      if (message.method === INITIALIZE) return this.answerInitialize(lease, message)
      const upstreamRequest = this.ledger.trackLease(lease, message)
      return this.sendUpstream(upstreamRequest).catch((error: unknown) => {
        this.ledger.forget(upstreamRequest.id)
        throw error
      })
    }
    if (isJsonRpcNotification(message)) return this.forwardLeaseNotification(lease, message)
    // A client's answer to a server request it was given.
    this.router.answered(message.id)
    return this.sendUpstream(message)
  }

  private async answerInitialize(lease: McpConnectionLease, message: JsonRpcRequest) {
    this.initializeWaiters.set(lease, message.id)
    try {
      const result = await this.ensureHandshake(message.params)
      lease.deliver({ jsonrpc: '2.0', id: message.id, result })
    } catch (error) {
      lease.deliver(
        errorResponse(message.id, JSON_RPC_ERROR_CODES.internalError, toError(error).message),
      )
    } finally {
      this.initializeWaiters.delete(lease)
    }
  }

  private async forwardLeaseNotification(lease: McpConnectionLease, message: JsonRpcNotification) {
    if (message.method === INITIALIZED) {
      if (this.initializedSent) return
      this.initializedSent = true
      return this.sendUpstream(message)
    }
    if (message.method === CANCELLED) {
      const params = isRecord(message.params) ? message.params : {}
      const upstreamId = this.ledger.upstreamId(lease, params.requestId)
      if (upstreamId === undefined) return
      this.ledger.forget(upstreamId)
      return this.sendUpstream({ ...message, params: { ...params, requestId: upstreamId } })
    }
    return this.sendUpstream(message)
  }

  private detachLease(lease: McpConnectionLease) {
    this.leases.delete(lease)
    for (const id of this.ledger.openRequests(lease)) {
      this.ledger.forget(id)
      void this.sendUpstream({
        jsonrpc: '2.0',
        method: CANCELLED,
        params: { requestId: id, reason: 'The client detached' },
      }).catch(() => undefined)
    }
    this.router.detach(lease)
  }

  private handleUpstreamMessage(message: JsonRpcMessage) {
    if (isJsonRpcRequest(message)) {
      void this.router.handle(message)
      return
    }
    if (isJsonRpcNotification(message)) {
      this.handleServerNotification(message)
      return
    }
    this.handleResponse(message)
  }

  private handleResponse(message: JsonRpcResponse) {
    const pending = this.ledger.forget(message.id)
    if (!pending) return
    if (pending.kind === 'internal') {
      if ('result' in message) return pending.resolve(message.result)
      const { message: text, code, data } = message.error
      return pending.reject(new McpServerError(text, code, data))
    }
    if (pending.lease.isDetached) return
    if (!('result' in message)) return pending.lease.deliver({ ...message, id: pending.id })
    this.options.observeResult?.(pending.method, pending.params, message.result)
    const result = this.options.adaptResult?.(pending.method, message.result) ?? message.result
    pending.lease.deliver({ ...message, id: pending.id, result })
  }

  private handleServerNotification(notification: JsonRpcNotification) {
    const params = isRecord(notification.params) ? notification.params : undefined
    if (notification.method === PROGRESS && params) {
      const route = this.ledger.progressRoute(params.progressToken)
      route?.lease.deliver({ ...notification, params: { ...params, progressToken: route.token } })
      return
    }
    if (notification.method === CANCELLED && params) {
      this.router.cancelled(params.requestId)?.deliver(notification)
      return
    }
    for (const lease of this.leases) lease.deliver(notification)
  }

  private markClosed(error: Error) {
    if (this.closed) return
    this.closed = true
    this.router.close()
    this.ledger.rejectInternal(error)
    // A client still waiting for its handshake learns why, stderr included, before it sees the close.
    for (const [lease, id] of this.initializeWaiters) {
      lease.deliver(errorResponse(id, JSON_RPC_ERROR_CODES.internalError, error.message))
    }
    this.initializeWaiters.clear()
    for (const lease of [...this.leases]) lease.detach()
    this.options.onClosed()
  }
}

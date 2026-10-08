import { isRecord } from '@shared/utils/validation'
import { McpClientRequestLedger } from './mcp-client-request-ledger'
import { McpConnectionHandshake } from './mcp-connection-handshake'
import { McpConnectionLease } from './mcp-connection-lease'
import {
  CANCELLED,
  DISCARDING_ERRORS,
  errorResponse,
  INITIALIZE,
  INITIALIZED,
  type McpPooledConnectionOptions,
  McpServerError,
  type McpUpstream,
  PROGRESS,
} from './mcp-connection-support'
import { McpServerRequestRouter } from './mcp-server-request-router'
import {
  isJsonRpcNotification,
  isJsonRpcRequest,
  JSON_RPC_ERROR_CODES,
  type JsonRpcMessage,
  type JsonRpcNotification,
  type JsonRpcRequest,
  type JsonRpcResponse,
  toError,
} from './mcp-wire'

/** How long a retiring connection waits for its open requests before it closes anyway. */
const RETIRE_GRACE_MS = 30_000

/**
 * One server connection of one Session, shared by the Pi clients of that Session's successive
 * Runs (leases) and by OpenWaggle's own requests. It answers repeated `initialize` requests from
 * the cached handshake and numbers requests upstream so clients never collide
 * (`McpClientRequestLedger`); server requests go through `McpServerRequestRouter`.
 */
export class McpPooledConnection {
  private upstream: McpUpstream | undefined
  private starting: Promise<void> | undefined
  private closed = false
  /** No longer offered to new clients; closes once its open requests are answered. */
  private retiring = false
  private released: Promise<void> | undefined
  private lastErrorValue: string | undefined
  private readonly ledger = new McpClientRequestLedger()
  private readonly leases = new Set<McpConnectionLease>()
  private readonly handshake: McpConnectionHandshake
  private readonly router: McpServerRequestRouter

  constructor(private readonly options: McpPooledConnectionOptions) {
    this.handshake = new McpConnectionHandshake({
      request: (method, params) => this.sendInternal(method, params),
      notify: (message) => this.sendUpstream(message),
      augmentParams: options.augmentInitializeParams,
      onProtocolVersion: (version) => this.upstream?.transport.setProtocolVersion?.(version),
    })
    this.router = new McpServerRequestRouter({
      send: (message) => this.sendUpstream(message),
      leases: () => this.leases,
      options,
    })
  }

  get serverName() {
    return this.options.serverName
  }

  /** Closed, or going away: either way no new client or request may use it. */
  get isClosed() {
    return this.closed || this.retiring
  }

  /** Open and past its handshake. */
  get isReady() {
    return !this.isClosed && this.handshake.isDone
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
    if (this.isClosed) throw this.closedConnectionError()
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
    await this.handshake.ensureInitialized()
    return this.sendInternal(method, params, options.signal)
  }

  async close() {
    if (!this.closed)
      this.markClosed(new Error(`MCP server "${this.serverName}" connection closed`))
    await this.releaseUpstream()
  }

  /** Closes the transport, then what the upstream holds beside it; once. */
  private releaseUpstream() {
    const upstream = this.upstream
    this.released ??= upstream
      ? upstream.transport
          .close()
          .catch(() => undefined)
          .then(() => upstream.close?.())
          .catch(() => undefined)
      : Promise.resolve()
    return this.released
  }

  /**
   * After an error that makes the upstream unusable (an expired HTTP session, a needed sign-in),
   * the connection takes no new clients, lets the requests already sent settle, then closes.
   */
  private retire() {
    if (this.retiring) return
    this.retiring = true
    if (!this.ledger.hasPending) {
      void this.close()
      return
    }
    setTimeout(() => void this.close(), RETIRE_GRACE_MS).unref()
  }

  private closedConnectionError() {
    return new Error(`MCP server "${this.serverName}" connection is closed`)
  }

  private start() {
    if (this.isClosed) return Promise.reject(this.closedConnectionError())
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
      await this.releaseUpstream()
      throw failure
    }
  }

  private withStderr(error: Error) {
    const stderr = this.stderrTail.trim()
    return stderr ? new Error(`${error.message}\n${stderr}`) : error
  }

  /**
   * Sends to the server. `settleFailed` drops the request that failed from the ledger before an
   * unusable upstream is retired, so the connection does not wait for a request that cannot be
   * answered.
   */
  private sendUpstream(message: JsonRpcMessage, settleFailed?: (failure: Error) => void) {
    const upstream = this.upstream
    if (!upstream || this.closed) return Promise.reject(this.closedConnectionError())
    return upstream.transport.send(message).catch((error: unknown) => {
      const failure = toError(error)
      settleFailed?.(failure)
      if (DISCARDING_ERRORS.has(failure.name)) this.retire()
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
    this.sendUpstream(request, (failure) => this.ledger.rejectRequest(id, failure)).catch(
      () => undefined,
    )
    return response
  }

  private async sendFromLease(lease: McpConnectionLease, message: JsonRpcMessage) {
    if (isJsonRpcRequest(message)) {
      if (this.retiring) throw this.closedConnectionError()
      if (message.method === INITIALIZE) return this.handshake.answer(lease, message)
      const upstreamRequest = this.ledger.trackLease(lease, message)
      return this.sendUpstream(upstreamRequest, () => this.ledger.forget(upstreamRequest.id))
    }
    if (isJsonRpcNotification(message)) return this.forwardLeaseNotification(lease, message)
    // A client's answer to a server request it was given.
    this.router.answered(message.id)
    return this.sendUpstream(message)
  }

  private async forwardLeaseNotification(lease: McpConnectionLease, message: JsonRpcNotification) {
    if (message.method === INITIALIZED) return this.handshake.initialized(message)
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
    this.deliverResponse(message)
    if (this.retiring && !this.ledger.hasPending) void this.close()
  }

  private deliverResponse(message: JsonRpcResponse) {
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
    this.ledger.failAll(error, (lease, id) =>
      lease.deliver(errorResponse(id, JSON_RPC_ERROR_CODES.internalError, error.message)),
    )
    this.handshake.fail(error)
    for (const lease of [...this.leases]) lease.detach()
    this.options.onClosed()
    void this.releaseUpstream()
  }
}

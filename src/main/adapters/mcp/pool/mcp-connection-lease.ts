import { type JsonRpcMessage, type McpWireTransport, WireTransportEvents } from './mcp-wire'

/** What a lease needs from the pooled connection it is attached to. */
export interface McpLeaseHost {
  readonly start: () => Promise<void>
  readonly send: (lease: McpConnectionLease, message: JsonRpcMessage) => Promise<void>
  readonly detach: (lease: McpConnectionLease) => void
  readonly setProtocolVersion: (version: string) => void
}

/**
 * The transport Pi's MCP client is given for one server: a lease on the Session's pooled
 * connection. Closing it detaches the client and leaves the server connection open, so the
 * connection outlives the Pi session that is disposed after every Run.
 */
export class McpConnectionLease extends WireTransportEvents implements McpWireTransport {
  private detached = false

  constructor(private readonly host: McpLeaseHost) {
    super()
  }

  get isDetached() {
    return this.detached
  }

  start() {
    if (this.detached) return Promise.reject(new Error('MCP connection lease is closed'))
    return this.host.start()
  }

  send(message: JsonRpcMessage) {
    if (this.detached) return Promise.reject(new Error('MCP connection lease is closed'))
    return this.host.send(this, message)
  }

  setProtocolVersion(version: string) {
    this.host.setProtocolVersion(version)
  }

  async close() {
    this.detach()
  }

  /** Delivers a server message to the client holding the lease. */
  deliver(message: JsonRpcMessage) {
    if (!this.detached) this.emitMessage(message)
  }

  deliverError(error: Error) {
    if (!this.detached) this.emitError(error)
  }

  /** The connection closed under the lease, or the lease was closed: the client sees a close. */
  detach() {
    if (this.detached) return
    this.detached = true
    this.host.detach(this)
    this.emitClose()
  }
}

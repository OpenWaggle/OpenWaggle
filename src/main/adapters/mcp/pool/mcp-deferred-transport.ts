import { type JsonRpcMessage, type McpWireTransport, WireTransportEvents } from './mcp-wire'

/**
 * A transport created when it starts, for the SDK transports that load asynchronously. A close
 * that arrives while it is still being created closes it as soon as it exists.
 */
export class DeferredTransport extends WireTransportEvents implements McpWireTransport {
  private inner: McpWireTransport | undefined
  private protocolVersion: string | undefined
  private closed = false

  constructor(
    private readonly create: () => Promise<McpWireTransport>,
    /** Replaces a start failure with the error a wrapped fetch saw, such as a needed sign-in. */
    private readonly startFailure: () => Error | undefined = () => undefined,
  ) {
    super()
  }

  async start() {
    const inner = await this.create()
    if (this.closed) {
      await inner.close().catch(() => undefined)
      throw new Error('MCP transport closed while starting')
    }
    this.inner = inner
    inner.onMessage((message) => this.emitMessage(message))
    inner.onError((error) => this.emitError(error))
    inner.onClose(() => this.emitClose())
    if (this.protocolVersion) inner.setProtocolVersion?.(this.protocolVersion)
    try {
      await inner.start()
    } catch (error) {
      throw this.startFailure() ?? error
    }
    if (this.closed) await inner.close().catch(() => undefined)
  }

  send(message: JsonRpcMessage) {
    if (!this.inner) return Promise.reject(new Error('MCP transport is not started'))
    return this.inner.send(message)
  }

  async close() {
    if (this.closed) return
    this.closed = true
    if (this.inner) await this.inner.close()
    this.emitClose()
  }

  setProtocolVersion(version: string) {
    this.protocolVersion = version
    this.inner?.setProtocolVersion?.(version)
  }
}

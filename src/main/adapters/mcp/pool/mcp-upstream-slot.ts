import type { McpUpstream } from './mcp-connection-support'
import { type JsonRpcMessage, toError } from './mcp-wire'

/** What the server process of a pooled connection reports to it, and what it needs to open. */
export interface McpUpstreamSlotHost {
  readonly serverName: string
  readonly open: () => McpUpstream | Promise<McpUpstream>
  /** Whether the connection was closed, so a process that finishes opening is released. */
  readonly isClosed: () => boolean
  readonly closedError: () => Error
  readonly onMessage: (message: JsonRpcMessage) => void
  readonly onError: (error: Error) => void
  /** The process closed the transport; the error names it, with its stderr. */
  readonly onClosed: (error: Error) => void
  /** The process could not be opened or started. */
  readonly onOpenFailed: (error: Error) => void
}

/**
 * The server process (or HTTP session) a pooled connection currently talks to: opened once on
 * first use, listened to, released once, and replaceable by a fresh one without closing the
 * connection.
 */
export class McpUpstreamSlot {
  private upstream: McpUpstream | undefined
  private starting: Promise<void> | undefined
  private released: Promise<void> | undefined
  /** Stops listening to the process, so one that is replaced cannot close the connection. */
  private readonly listeners: Array<() => void> = []

  constructor(private readonly host: McpUpstreamSlotHost) {}

  get current() {
    return this.upstream
  }

  get stderrTail() {
    return this.upstream?.stderrTail?.() ?? ''
  }

  start() {
    this.starting ??= this.open()
    return this.starting
  }

  /**
   * Closes the transport, then what the upstream holds beside it; once. Nothing is recorded while
   * the upstream is still opening, so the open that finds the connection closed releases it.
   */
  release() {
    const upstream = this.upstream
    if (!upstream) return Promise.resolve()
    this.released ??= upstream.transport
      .close()
      .catch(() => undefined)
      .then(() => upstream.close?.())
      .catch(() => undefined)
    return this.released
  }

  /** Closes the current process without telling the connection, and opens another in its place. */
  async replace() {
    for (const stopListening of this.listeners.splice(0)) stopListening()
    await this.release()
    this.upstream = undefined
    this.starting = undefined
    this.released = undefined
    await this.start()
  }

  private withStderr(error: Error) {
    const stderr = this.stderrTail.trim()
    return stderr ? new Error(`${error.message}\n${stderr}`) : error
  }

  private async open() {
    try {
      const upstream = await this.host.open()
      this.upstream = upstream
      // Closed while it was opening (it may read vault secrets first): release it below.
      if (this.host.isClosed()) throw this.host.closedError()
      this.listeners.push(
        upstream.transport.onMessage(this.host.onMessage),
        upstream.transport.onError(this.host.onError),
        upstream.transport.onClose(() => {
          this.host.onClosed(
            this.withStderr(
              new Error(`MCP server "${this.host.serverName}" closed the connection`),
            ),
          )
        }),
      )
      await upstream.transport.start()
    } catch (error) {
      const failure = this.withStderr(toError(error))
      this.host.onOpenFailed(failure)
      await this.release()
      throw failure
    }
  }
}

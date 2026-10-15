import type { McpConnectionLease } from './mcp-connection-lease'
import { errorResponse, type McpPooledConnectionOptions } from './mcp-connection-support'
import {
  isJsonRpcId,
  JSON_RPC_ERROR_CODES,
  type JsonRpcId,
  type JsonRpcMessage,
  type JsonRpcRequest,
  toError,
} from './mcp-wire'

interface McpServerRequestRouterHost {
  readonly send: (message: JsonRpcMessage) => Promise<void>
  /** The clients attached now; the first one answers requests the layer does not handle. */
  readonly leases: () => Iterable<McpConnectionLease>
  readonly options: Pick<McpPooledConnectionOptions, 'handleServerRequest' | 'roots'>
}

/**
 * The server-to-client half of a pooled connection. Requests the layer owns (ping, roots,
 * sampling, elicitation) are answered here, whether or not a client is attached; anything else
 * goes to an attached client, or is refused when none is.
 */
export class McpServerRequestRouter {
  private readonly active = new Map<JsonRpcId, AbortController>()
  private readonly forwarded = new Map<JsonRpcId, McpConnectionLease>()

  constructor(private readonly host: McpServerRequestRouterHost) {}

  async handle(request: JsonRpcRequest) {
    const controller = new AbortController()
    this.active.set(request.id, controller)
    try {
      const handled = this.answer(request, controller.signal)
      if (handled === undefined) {
        this.forward(request)
        return
      }
      const result = await handled
      if (!controller.signal.aborted)
        await this.host.send({ jsonrpc: '2.0', id: request.id, result })
    } catch (error) {
      if (!controller.signal.aborted) {
        await this.host
          .send(
            errorResponse(request.id, JSON_RPC_ERROR_CODES.internalError, toError(error).message),
          )
          .catch(() => undefined)
      }
    } finally {
      this.active.delete(request.id)
    }
  }

  /** The server cancelled one of its requests. Returns the client to tell, if a client holds it. */
  cancelled(requestId: unknown) {
    if (!isJsonRpcId(requestId)) return undefined
    this.active.get(requestId)?.abort()
    const lease = this.forwarded.get(requestId)
    this.forwarded.delete(requestId)
    return lease
  }

  /**
   * Whether a request of the server's is still being answered, here or by a client. Its answer
   * belongs to the process that asked, so that process must not be replaced meanwhile.
   */
  get hasOpenRequests() {
    return this.active.size > 0 || this.forwarded.size > 0
  }

  /** A client answered a server request it was given. */
  answered(id: JsonRpcId) {
    this.forwarded.delete(id)
  }

  /** A client detached: its unanswered server requests fail instead of hanging. */
  detach(lease: McpConnectionLease) {
    for (const [id, holder] of [...this.forwarded]) {
      if (holder !== lease) continue
      this.forwarded.delete(id)
      void this.host
        .send(errorResponse(id, JSON_RPC_ERROR_CODES.internalError, 'The client detached'))
        .catch(() => undefined)
    }
  }

  close() {
    for (const controller of this.active.values()) controller.abort()
    this.active.clear()
    this.forwarded.clear()
  }

  private answer(request: JsonRpcRequest, signal: AbortSignal) {
    if (request.method === 'ping') return Promise.resolve({})
    if (request.method === 'roots/list') {
      return Promise.resolve({ roots: [...(this.host.options.roots?.() ?? [])] })
    }
    return this.host.options.handleServerRequest?.({
      method: request.method,
      params: request.params,
      signal,
    })
  }

  private forward(request: JsonRpcRequest) {
    let lease: McpConnectionLease | undefined
    for (const attached of this.host.leases()) {
      lease = attached
      break
    }
    if (!lease) {
      void this.host
        .send(
          errorResponse(
            request.id,
            JSON_RPC_ERROR_CODES.methodNotFound,
            `Method not found: ${request.method}`,
          ),
        )
        .catch(() => undefined)
      return
    }
    this.forwarded.set(request.id, lease)
    lease.deliver(request)
  }
}

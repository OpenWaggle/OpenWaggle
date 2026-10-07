import type { McpConnectionLease } from './mcp-connection-lease'
import { type Pending, progressTokenOf, withProgressToken } from './mcp-connection-support'
import { isJsonRpcId, type JsonRpcId, type JsonRpcRequest } from './mcp-wire'

/**
 * Upstream request numbering for one pooled connection. Every client numbers its requests from 1,
 * so each request gets a connection-wide id upstream, and its progress token is rewritten to that
 * id; responses, progress, and cancellations are mapped back to the client's own ids.
 */
export class McpClientRequestLedger {
  private nextId = 1
  private readonly pending = new Map<JsonRpcId, Pending>()
  private readonly progress = new Map<JsonRpcId, { lease: McpConnectionLease; token: JsonRpcId }>()
  private readonly leaseIds = new WeakMap<McpConnectionLease, Map<JsonRpcId, JsonRpcId>>()

  allocate() {
    const id = this.nextId
    this.nextId += 1
    return id
  }

  /**
   * Waits for the response to one of OpenWaggle's own requests. Aborting `signal` forgets the
   * request, calls `cancel` so the server is told, and rejects.
   */
  waitForInternal(id: JsonRpcId, signal: AbortSignal | undefined, cancel: () => void) {
    return new Promise<unknown>((resolve, reject) => {
      if (signal?.aborted) {
        reject(new Error('MCP request aborted'))
        return
      }
      const onAbort = () => {
        this.forget(id)
        cancel()
        reject(new Error('MCP request aborted'))
      }
      signal?.addEventListener('abort', onAbort, { once: true })
      this.pending.set(id, {
        kind: 'internal',
        resolve: (result) => {
          signal?.removeEventListener('abort', onAbort)
          resolve(result)
        },
        reject: (error) => {
          signal?.removeEventListener('abort', onAbort)
          reject(error)
        },
      })
    })
  }

  /** Fails one of OpenWaggle's own requests, for example because it could not be sent. */
  rejectRequest(id: JsonRpcId, error: Error) {
    const pending = this.forget(id)
    if (pending?.kind === 'internal') pending.reject(error)
  }

  /** Records a client request and returns it renumbered for the server. */
  trackLease(lease: McpConnectionLease, message: JsonRpcRequest): JsonRpcRequest {
    const id = this.allocate()
    const token = progressTokenOf(message.params)
    if (token !== undefined) this.progress.set(id, { lease, token })
    this.pending.set(id, {
      kind: 'lease',
      lease,
      id: message.id,
      method: message.method,
      params: message.params,
      ...(token === undefined ? {} : { progressToken: id }),
    })
    const ids = this.leaseIds.get(lease) ?? new Map<JsonRpcId, JsonRpcId>()
    ids.set(message.id, id)
    this.leaseIds.set(lease, ids)
    const params = token === undefined ? message.params : withProgressToken(message.params, id)
    return { ...message, id, ...(params === undefined ? {} : { params }) }
  }

  upstreamId(lease: McpConnectionLease, requestId: unknown) {
    return isJsonRpcId(requestId) ? this.leaseIds.get(lease)?.get(requestId) : undefined
  }

  forget(id: JsonRpcId) {
    const pending = this.pending.get(id)
    this.pending.delete(id)
    this.progress.delete(id)
    if (pending?.kind === 'lease') this.leaseIds.get(pending.lease)?.delete(pending.id)
    return pending
  }

  /** The client a server progress notification belongs to, with the client's own token. */
  progressRoute(token: unknown) {
    return isJsonRpcId(token) ? this.progress.get(token) : undefined
  }

  /** Upstream ids of a client's requests that have not been answered. */
  openRequests(lease: McpConnectionLease) {
    return [...this.pending]
      .filter(([, pending]) => pending.kind === 'lease' && pending.lease === lease)
      .map(([id]) => id)
  }

  rejectInternal(error: Error) {
    for (const [id, pending] of [...this.pending]) {
      this.pending.delete(id)
      if (pending.kind === 'internal') pending.reject(error)
    }
    this.progress.clear()
  }
}

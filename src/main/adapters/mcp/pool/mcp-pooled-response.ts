import type { McpClientRequestLedger } from './mcp-client-request-ledger'
import { type McpPooledConnectionOptions, McpServerError } from './mcp-connection-support'
import type { McpUpstreamReplacement } from './mcp-upstream-replacement'
import type { JsonRpcResponse } from './mcp-wire'

/**
 * Delivers the server's answer to whoever asked: OpenWaggle's own request, or the lease of the
 * client whose request it was, with its own id, the result observed and adapted first. An error a
 * replacement of the server handles (a stuck process) is not delivered.
 */
export function deliverPooledResponse(
  message: JsonRpcResponse,
  connection: {
    readonly ledger: McpClientRequestLedger
    readonly replacement: McpUpstreamReplacement
    readonly options: Pick<McpPooledConnectionOptions, 'observeResult' | 'adaptResult'>
  },
) {
  const pending = connection.ledger.forget(message.id)
  if (!pending) return
  if (pending.kind === 'internal') {
    if ('result' in message) return pending.resolve(message.result)
    const { message: text, code, data } = message.error
    return pending.reject(new McpServerError(text, code, data))
  }
  if (pending.lease.isDetached) return
  if (!('result' in message)) {
    if (connection.replacement.handleError(pending, message)) return
    return pending.lease.deliver({ ...message, id: pending.id })
  }
  const { observeResult, adaptResult } = connection.options
  observeResult?.(pending.method, pending.params, message.result)
  const result = adaptResult?.(pending.method, message.result) ?? message.result
  pending.lease.deliver({ ...message, id: pending.id, result })
}

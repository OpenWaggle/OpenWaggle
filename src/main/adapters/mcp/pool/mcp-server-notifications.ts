import { isRecord } from '@shared/utils/validation'
import type { McpClientRequestLedger } from './mcp-client-request-ledger'
import type { McpConnectionLease } from './mcp-connection-lease'
import { CANCELLED, PROGRESS } from './mcp-connection-support'
import type { McpServerRequestRouter } from './mcp-server-request-router'
import type { JsonRpcNotification } from './mcp-wire'

/**
 * Routes a server notification: progress to the client whose request it reports on, with that
 * client's token; a cancellation to the client handling the server request; anything else to all.
 */
export function deliverServerNotification(
  notification: JsonRpcNotification,
  ledger: McpClientRequestLedger,
  router: McpServerRequestRouter,
  leases: Iterable<McpConnectionLease>,
) {
  const params = isRecord(notification.params) ? notification.params : undefined
  if (notification.method === PROGRESS && params) {
    const route = ledger.progressRoute(params.progressToken)
    route?.lease.deliver({ ...notification, params: { ...params, progressToken: route.token } })
    return
  }
  if (notification.method === CANCELLED && params) {
    router.cancelled(params.requestId)?.deliver(notification)
    return
  }
  for (const lease of leases) lease.deliver(notification)
}

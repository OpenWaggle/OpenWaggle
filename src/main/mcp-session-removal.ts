import type { McpConnectionPool } from './adapters/mcp/pool/mcp-connection-pool-api'
import { forgetMcpAppTools } from './adapters/pi/mcp/mcp-app-registry'
import { onSessionRemoved } from './application/session-removal-hooks'

let installed = false

/**
 * Archiving or deleting a Session, including Hive cleanup of a Worker, closes its MCP servers and
 * forgets its MCP App tools. Its MCP switch stays: an archived Session may be unarchived, and a
 * deleted one takes its switch row with it (foreign key cascade). Installed once.
 */
export function installMcpSessionRemoval(pool: Pick<McpConnectionPool, 'closeSession'>) {
  if (installed) return
  installed = true
  onSessionRemoved(async (sessionId) => {
    forgetMcpAppTools(sessionId)
    await pool.closeSession(sessionId)
  })
}

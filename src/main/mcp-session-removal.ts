import { forgetSessionMcpSwitch } from './adapters/mcp/mcp-session-switch'
import { mcpSessionConnectionPool } from './adapters/mcp/pool/mcp-connection-pool-instance'
import { forgetMcpAppTools } from './adapters/pi/mcp/mcp-app-registry'
import { onSessionRemoved } from './application/session-removal-hooks'

let installed = false

/**
 * Archiving or deleting a Session, including Hive cleanup of a Worker, closes its MCP servers and
 * drops what the Host kept for it: its MCP App tools and its MCP switch. Installed once.
 */
export function installMcpSessionRemoval() {
  if (installed) return
  installed = true
  onSessionRemoved((sessionId) => {
    forgetMcpAppTools(sessionId)
    forgetSessionMcpSwitch(sessionId)
    return mcpSessionConnectionPool.closeSession(sessionId)
  })
}

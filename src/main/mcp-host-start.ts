import { installMcpTurnedOffServerClosing } from './adapters/pi/mcp/mcp-turned-off-servers'
import { hostMcpConnectionPool } from './mcp-runtime-layers'
import { installMcpSessionRemoval } from './mcp-session-removal'
import { loadMcpShellEnvironment } from './mcp-shell-environment'

/**
 * The MCP work the Session Host starts once, with its owned services. Never in the desktop app,
 * whose MCP channels are all Host-backed: it would read the login shell's environment, tokens
 * included, and install connection pool hooks for nothing.
 */
export function startMcpHostServices() {
  // Archiving or deleting a Session, including Hive cleanup of a Worker, closes its MCP servers.
  installMcpSessionRemoval(hostMcpConnectionPool)
  // A server turned off or removed stops being used by MCP Apps and running Runs alike.
  installMcpTurnedOffServerClosing(hostMcpConnectionPool)
  // MCP `${NAME}` values resolve from the user's login shell too; read it once, in the background.
  void loadMcpShellEnvironment()
}

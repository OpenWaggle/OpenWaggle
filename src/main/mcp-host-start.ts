import { hostMcpConnectionPool } from './mcp-runtime-layers'
import { installMcpSessionRemoval } from './mcp-session-removal'
import { loadMcpShellEnvironment } from './mcp-shell-environment'

/** The MCP work the Host starts once, when its runtime is initialized. */
export function startMcpHostServices() {
  // Archiving or deleting a Session, including Hive cleanup of a Worker, closes its MCP servers.
  installMcpSessionRemoval(hostMcpConnectionPool)
  // MCP `${NAME}` values resolve from the user's login shell too; read it once, in the background.
  void loadMcpShellEnvironment()
}

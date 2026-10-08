import { setMcpConnectionHooks } from './adapters/mcp/pool/mcp-connection-pool-instance'
import { openWaggleMcpConnectionHooks } from './adapters/pi/mcp/mcp-session-context'
import { installMcpSessionRemoval } from './mcp-session-removal'
import { loadMcpShellEnvironment } from './mcp-shell-environment'

/** The MCP work the Host starts once, when its runtime is initialized. */
export function startMcpHostServices() {
  // Client capabilities, sampling, elicitation, and MCP App observation on every pooled connection.
  setMcpConnectionHooks(openWaggleMcpConnectionHooks)
  // Archiving or deleting a Session, including Hive cleanup of a Worker, closes its MCP servers.
  installMcpSessionRemoval()
  // MCP `${NAME}` values resolve from the user's login shell too; read it once, in the background.
  void loadMcpShellEnvironment()
}

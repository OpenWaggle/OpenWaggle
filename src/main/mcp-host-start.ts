import { migrateOpenWaggleMcpFilesOnce } from './adapters/pi/mcp/openwaggle-mcp-migration'
import { installMcpSessionRemoval } from './mcp-session-removal'
import { loadMcpShellEnvironment } from './mcp-shell-environment'

/** The MCP work the Host starts once, when its runtime is initialized. */
export function startMcpHostServices() {
  // Archiving or deleting a Session, including Hive cleanup of a Worker, closes its MCP servers.
  installMcpSessionRemoval()
  // MCP `${NAME}` values resolve from the user's login shell too; read it once, in the background.
  void loadMcpShellEnvironment()
  // Settings, the CLI, and Runs then all see the migrated MCP files.
  void migrateOpenWaggleMcpFilesOnce(null)
}

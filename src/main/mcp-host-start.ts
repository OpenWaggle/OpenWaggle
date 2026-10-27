import { forgetStatesOfSwitchedMcpServers } from './adapters/pi/mcp/mcp-server-status-freshness'
import { installMcpTurnedOffServerClosing } from './adapters/pi/mcp/mcp-turned-off-servers'
import { getOpenWaggleMcpConfigurationService } from './adapters/pi/mcp/openwaggle-mcp-configuration'
import { createLogger } from './logger'
import { hostMcpConnectionPool } from './mcp-runtime-layers'
import { installMcpSessionRemoval } from './mcp-session-removal'
import { settledWorkerIdleCloseMs, workerDelegationState } from './mcp-settled-worker-idle-policy'
import { loadMcpShellEnvironment } from './mcp-shell-environment'

const logger = createLogger('mcp-host-start')

/** Settled Hive Workers close their MCP servers a minute after their Run (D1.1). */
function installSettledWorkerIdleClose() {
  hostMcpConnectionPool.setIdleClosePolicy(async (sessionId) => {
    // Lazily: the runtime imports this module.
    const { runAppEffect } = await import('./runtime')
    return settledWorkerIdleCloseMs(await runAppEffect(workerDelegationState(sessionId)))
  })
}

function installMcpServerStatusFreshness() {
  getOpenWaggleMcpConfigurationService().onChange(() => {
    try {
      forgetStatesOfSwitchedMcpServers()
    } catch (error) {
      logger.error('Could not compare MCP servers after a change', {
        error: error instanceof Error ? error.message : String(error),
      })
    }
  })
}

/**
 * The MCP work the Session Host starts once, with its owned services. Never in the desktop app,
 * whose MCP channels are all Host-backed: it would read the login shell's environment, tokens
 * included, and install connection pool hooks for nothing.
 */
export function startMcpHostServices() {
  // Archiving or deleting a Session, including Hive cleanup of a Worker, closes its MCP servers.
  installMcpSessionRemoval(hostMcpConnectionPool)
  installSettledWorkerIdleClose()
  // A server turned off or removed stops being used by MCP Apps and running Runs alike.
  installMcpTurnedOffServerClosing(hostMcpConnectionPool)
  // A server turned off or on no longer shows a state from before, wherever it was switched.
  installMcpServerStatusFreshness()
  // MCP `${NAME}` values resolve from the user's login shell too; read it once, in the background.
  void loadMcpShellEnvironment()
}

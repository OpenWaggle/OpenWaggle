/**
 * A server turned off or removed must stop being used at once (ADR 0051): by MCP Apps, which use
 * the Session's warm connection, and by a running Run, whose Pi client would otherwise keep or
 * reopen it. After every configuration change, each warm connection is checked against its own
 * project's configuration, so a server still on in another project stays connected there.
 */
import { homedir } from 'node:os'
import { createLogger } from '../../../logger'
import { loadMcpMergedConfig } from '../../mcp/config/mcp-runtime-config'
import type { McpConnectionPool } from '../../mcp/pool/mcp-connection-pool-api'
import { getPiAgentDir } from '../pi-provider-catalog'
import { getOpenWaggleMcpConfigurationService } from './openwaggle-mcp-configuration'

const logger = createLogger('mcp-turned-off-servers')

interface ConfiguredServer {
  readonly name: string
  readonly enabled: boolean
}

/** The project's servers, or undefined while a file cannot be read (nothing can be told then). */
type ConfiguredServers = (projectPath: string | null) => readonly ConfiguredServer[] | undefined

function configuredServers(projectPath: string | null) {
  const merged = loadMcpMergedConfig({
    homeDir: homedir(),
    piAgentDir: getPiAgentDir(),
    projectPath,
  })
  if (merged.errors.length > 0) return undefined
  return merged.servers.map((server) => ({
    name: server.name,
    enabled: server.config.enabled !== false,
  }))
}

/** Closes each Session's connection to a server its project no longer has turned on. */
export async function closeTurnedOffMcpServers(
  pool: Pick<McpConnectionPool, 'closeServer' | 'serverConnections'>,
  servers: ConfiguredServers = configuredServers,
) {
  const byProject = new Map<string | null, ReadonlyMap<string, boolean> | undefined>()
  const closing: Promise<void>[] = []
  for (const connection of pool.serverConnections()) {
    // Only servers a configuration file defines are judged by it.
    if (connection.fromExtension) continue
    if (!byProject.has(connection.projectPath)) {
      const configured = servers(connection.projectPath)
      byProject.set(
        connection.projectPath,
        configured && new Map(configured.map((server) => [server.name, server.enabled])),
      )
    }
    const enabled = byProject.get(connection.projectPath)
    if (enabled && enabled.get(connection.name) !== true) {
      closing.push(pool.closeServer(connection.sessionId, connection.name))
    }
  }
  await Promise.all(closing)
}

/** Checks the warm connections after every saved MCP change: Settings, the CLI, or Pi's `/mcp`. */
export function installMcpTurnedOffServerClosing(
  pool: Pick<McpConnectionPool, 'closeServer' | 'serverConnections'>,
) {
  let queue: Promise<void> = Promise.resolve()
  return getOpenWaggleMcpConfigurationService().onChange(() => {
    queue = queue
      .then(() => closeTurnedOffMcpServers(pool))
      .catch((error: unknown) => {
        logger.error('Could not close MCP servers that were turned off', {
          error: error instanceof Error ? error.message : String(error),
        })
      })
  })
}

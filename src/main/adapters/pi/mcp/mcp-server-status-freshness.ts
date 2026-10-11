/**
 * A server's last known state describes the server as it was then: on, and connecting with the
 * values and vault secrets it had. Once it is turned off or on, removed, or what it connects with
 * changes (a secret saved again, say), that state is stale: "Connected, last checked 5 minutes
 * ago" would describe another server. Settings' state reads (and every saved MCP change, for the projects
 * those reads saw) compare each server with how they last saw it, and forget a state that no
 * longer applies.
 */
import { homedir } from 'node:os'
import type { McpConfiguredServerConfig } from '../../../domain/mcp/config/mcp-server-config'
import { loadMcpMergedConfig } from '../../mcp/config/mcp-runtime-config'
import { mcpServerIdentity } from '../../mcp/pool/mcp-connection-pool-api'
import { getPiAgentDir } from '../pi-provider-catalog'
import { forgetKnownMcpServerStateLearnedBy } from './mcp-server-status-registry'

export interface McpServerSighting {
  readonly name: string
  readonly identity: string
  readonly enabled: boolean
  /**
   * What its connection is made of (a fingerprint, secrets as stamps); null when it cannot be
   * resolved, such as while a secret is missing; undefined when not known, which keeps the last.
   */
  readonly connection?: string | null
}

interface SeenServer {
  readonly identity: string
  readonly enabled: boolean
  readonly connection: string | null | undefined
  /** When it was seen so. */
  readonly seenAt: number
}

/** Projects remembered at once; the one looked at longest ago is forgotten first. */
const MAX_PROJECTS = 64

const seen = new Map<string, ReadonlyMap<string, SeenServer>>()

function projectKey(projectPath: string | null) {
  return projectPath ?? ''
}

function changed(last: SeenServer, next: SeenServer) {
  return (
    last.enabled !== next.enabled ||
    last.connection !== next.connection ||
    last.identity !== next.identity
  )
}

/** Notes how a project's servers are now, forgetting the state of each that changed since. */
export function forgetStaleMcpServerStates(
  projectPath: string | null,
  servers: readonly McpServerSighting[],
  now: number = Date.now(),
) {
  const key = projectKey(projectPath)
  const before = seen.get(key)
  const current = new Map<string, SeenServer>()
  for (const server of servers) {
    const last = before?.get(server.name)
    const next: SeenServer = {
      identity: server.identity,
      enabled: server.enabled,
      connection: server.connection === undefined ? last?.connection : server.connection,
      seenAt: now,
    }
    // Only a state learned while it was still as last seen: a check made since, such as Check
    // connection right after an edit, may describe the server as it is now.
    if (last && changed(last, next)) {
      forgetKnownMcpServerStateLearnedBy(last.identity, last.seenAt)
      forgetKnownMcpServerStateLearnedBy(next.identity, last.seenAt)
    }
    current.set(server.name, next)
  }
  // A server removed since: one added again under its name is another server.
  for (const [name, last] of before ?? []) {
    if (!current.has(name)) forgetKnownMcpServerStateLearnedBy(last.identity, last.seenAt)
  }
  seen.delete(key)
  seen.set(key, current)
  for (const oldest of seen.keys()) {
    if (seen.size <= MAX_PROJECTS) break
    seen.delete(oldest)
  }
}

/** The identity of a configured server, before its vault values are resolved. */
export function configuredMcpServerIdentity(name: string, config: McpConfiguredServerConfig) {
  if ('url' in config) return mcpServerIdentity(name, { url: config.url })
  return mcpServerIdentity(name, {
    command: config.command,
    ...(config.args ? { args: config.args } : {}),
  })
}

/**
 * After a saved MCP change (Settings, the CLI, or Pi's `/mcp`), forgets the state of each server
 * turned off or on in a project Settings has shown, even if Settings does not look in between.
 */
export function forgetStatesOfSwitchedMcpServers() {
  for (const key of [...seen.keys()]) {
    const projectPath = key === '' ? null : key
    const merged = loadMcpMergedConfig({
      homeDir: homedir(),
      piAgentDir: getPiAgentDir(),
      projectPath,
    })
    // While a file cannot be read, nothing can be told about its servers.
    if (merged.errors.length > 0) continue
    forgetStaleMcpServerStates(
      projectPath,
      merged.servers.map((server) => ({
        name: server.name,
        identity: configuredMcpServerIdentity(server.name, server.config),
        enabled: server.config.enabled !== false,
      })),
    )
  }
}

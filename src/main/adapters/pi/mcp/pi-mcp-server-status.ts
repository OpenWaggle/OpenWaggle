import { getMcpToolExposure, type McpServerEntry } from '@earendil-works/pi-coding-agent'
import type {
  McpServerInspection,
  McpServerStatusView,
  McpServerToolView,
} from '@shared/types/mcp-configuration'
import type { McpConfigurationScopeInput } from '../../../ports/mcp-configuration-service'
import { loadMcpRuntimeConfig } from '../../mcp/config/mcp-runtime-config'
import {
  checkMcpVaultSecret,
  mcpVaultSecretStamps,
} from '../../mcp/encrypted-mcp-secret-vault-service'
import {
  type McpConnectionPool,
  mcpConnectionFingerprint,
  mcpServerIdentity,
} from '../../mcp/pool/mcp-connection-pool-api'
import {
  configuredMcpServerIdentity,
  forgetStaleMcpServerStates,
  type McpServerSighting,
} from './mcp-server-status-freshness'
import { knownMcpServerState, type McpKnownServerState } from './mcp-server-status-registry'
import { mcpSignedIn } from './pi-mcp-server-oauth'

export interface PiMcpServerRuntimeRoots {
  readonly homeDir: string
  readonly piAgentDir: string
}

type ConnectionStates = ReturnType<McpConnectionPool['connectionStates']>

function toolViews(entry: McpServerEntry, known: McpKnownServerState | undefined) {
  return (known?.tools ?? []).map(
    (tool): McpServerToolView => ({
      ...tool,
      exposure: getMcpToolExposure(entry.config, tool.name),
    }),
  )
}

/** A Session's warm connection: connected once its handshake is done, connecting before. */
function liveInspection(
  entry: McpServerEntry,
  live: ConnectionStates,
  known: McpKnownServerState | undefined,
): McpServerInspection {
  const ready = live.some((connection) => connection.ready)
  const error = live.find((connection) => connection.lastError)?.lastError
  return {
    name: entry.name,
    state: ready ? 'connected' : 'connecting',
    // Tools come from what a Run listed; nothing is asked of another Session's connection.
    tools: ready && known?.state === 'connected' ? toolViews(entry, known) : [],
    ...(!ready && error ? { error } : {}),
  }
}

function knownInspection(entry: McpServerEntry, known: McpKnownServerState): McpServerInspection {
  return {
    name: entry.name,
    state: known.state,
    tools: toolViews(entry, known),
    ...(known.error ? { error: known.error } : {}),
    ...(known.stderrTail ? { stderrTail: known.stderrTail } : {}),
  }
}

function serverStatus(
  entry: McpServerEntry,
  pool: McpConnectionPool,
  projectPath: string | null,
): McpServerStatusView {
  const signedIn = mcpSignedIn(entry)
  const base = { name: entry.name, ...(signedIn === undefined ? {} : { signedIn }) }
  if (entry.config.enabled === false) return { ...base, source: 'not-checked' }
  const identity = mcpServerIdentity(entry.name, entry.config)
  const known = knownMcpServerState(identity)
  const live = pool.connectionStates(identity, projectPath)
  if (live.length > 0) {
    return { ...base, source: 'live', inspection: liveInspection(entry, live, known) }
  }
  if (known) {
    return {
      ...base,
      source: 'last-check',
      inspection: knownInspection(entry, known),
      checkedAt: known.checkedAt,
    }
  }
  return { ...base, source: 'not-checked' }
}

/** How each server is now, so a state from before it was switched or changed is not shown. */
function sightings(config: Awaited<ReturnType<typeof loadMcpRuntimeConfig>>) {
  return config.merged.servers.map((server): McpServerSighting => {
    const connection = config.connectionConfigs.get(server.name)
    return {
      name: server.name,
      identity: configuredMcpServerIdentity(server.name, server.config),
      enabled: server.config.enabled !== false,
      connection: connection
        ? mcpConnectionFingerprint({ config: connection, transport: server.transport, cwd: '' })
        : null,
    }
  })
}

/**
 * Every configured server's state for Settings > MCP, read without connecting: a warm connection
 * of one of the project's Sessions, otherwise the last check, otherwise not checked. It reads the
 * files and the sign-in store only (`mcpSignedIn`, the synchronous store, cached by mtime); vault
 * secrets are checked to exist, not decrypted. A server whose secret is missing needs that secret
 * (`needsSecret`); another secret that cannot be read shows as a failed check. No server is
 * started and no request is sent.
 */
export async function getMcpServerStatuses(
  input: McpConfigurationScopeInput,
  roots: PiMcpServerRuntimeRoots,
  pool: McpConnectionPool,
): Promise<McpServerStatusView[]> {
  const config = await loadMcpRuntimeConfig({
    roots: { ...roots, projectPath: input.projectPath },
    resolveSecret: checkMcpVaultSecret,
    // Stands for each secret by when it was saved, without decrypting it.
    secretStamp: mcpVaultSecretStamps(),
  })
  // While a file cannot be read, its servers are unknown, not removed or changed.
  if (!config.merged.incomplete) {
    forgetStaleMcpServerStates(input.projectPath, sightings(config), {
      unchanged: config.merged.rejectedNames ?? [],
    })
  }
  const checkedAt = Date.now()
  return [
    ...config.loaded.servers.map((entry) => serverStatus(entry, pool, input.projectPath)),
    ...[...config.unavailable].map(([name, error]): McpServerStatusView => {
      // A server that is off is not checked, whatever it lacks.
      const off = config.merged.servers.some(
        (server) => server.name === name && server.config.enabled === false,
      )
      if (off) return { name, source: 'not-checked' }
      // Left out of Runs until the secret is added: nothing connected, so nothing failed.
      if (config.missingSecrets.has(name)) return { name, source: 'not-checked', needsSecret: true }
      return {
        name,
        source: 'last-check',
        checkedAt,
        inspection: { name, state: 'failed', tools: [], error },
      }
    }),
  ]
}

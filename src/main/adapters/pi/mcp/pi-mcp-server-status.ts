import { getMcpToolExposure, type McpServerEntry } from '@earendil-works/pi-coding-agent'
import type {
  McpServerInspection,
  McpServerStatusView,
  McpServerToolView,
} from '@shared/types/mcp-configuration'
import type { McpConfigurationScopeInput } from '../../../ports/mcp-configuration-service'
import { loadMcpRuntimeConfig } from '../../mcp/config/mcp-runtime-config'
import { resolveMcpVaultSecret } from '../../mcp/encrypted-mcp-secret-vault-service'
import { type McpConnectionPool, mcpServerIdentity } from '../../mcp/pool/mcp-connection-pool-api'
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

function serverStatus(entry: McpServerEntry, pool: McpConnectionPool): McpServerStatusView {
  const signedIn = mcpSignedIn(entry)
  const base = { name: entry.name, ...(signedIn === undefined ? {} : { signedIn }) }
  if (entry.config.enabled === false) return { ...base, source: 'not-checked' }
  const identity = mcpServerIdentity(entry.name, entry.config)
  const known = knownMcpServerState(identity)
  const live = pool.connectionStates(identity)
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

/**
 * Every configured server's state for Settings > MCP, read without connecting: a Session's warm
 * connection, otherwise the last check, otherwise not checked. It reads the files and the sign-in
 * store only; no server is started and no request is sent.
 */
export async function getMcpServerStatuses(
  input: McpConfigurationScopeInput,
  roots: PiMcpServerRuntimeRoots,
  pool: McpConnectionPool,
): Promise<McpServerStatusView[]> {
  const config = await loadMcpRuntimeConfig({
    roots: { ...roots, projectPath: input.projectPath },
    resolveSecret: resolveMcpVaultSecret,
  })
  return config.loaded.servers.map((entry) => serverStatus(entry, pool))
}

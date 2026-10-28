import { setTimeout as sleep } from 'node:timers/promises'
import {
  type ExtensionAPI,
  getMcpToolExposure,
  type McpServerEntry,
} from '@earendil-works/pi-coding-agent'
import { mcpServerIdentity } from '../../mcp/pool/mcp-connection-pool-api'
import { mcpAppToolNames } from './mcp-app-registry'
import { type CachedMcpAppTools, knownMcpAppTools } from './mcp-openwaggle-exposure'
import { knownMcpServerState } from './mcp-server-status-registry'

const POLL_INTERVAL_MS = 10

/**
 * A server seen failing or signed out since `since`: it lists no tools until that changes. The
 * state is kept by server identity for the whole Host, with no project, so one learned before this
 * Run may come from another project, or from a check made before the user fixed the server, and
 * says nothing about it here (review V2 P3-2). This Run's own connection says that (`failed`).
 */
function unusableSince(server: McpServerEntry, since: number) {
  const known = knownMcpServerState(mcpServerIdentity(server.name, server.config))
  if (!known || known.checkedAt < since) return false
  return known.state === 'failed' || known.state === 'needs-sign-in'
}

/**
 * Servers a Run cannot yet tell whether they offer MCP App tools: on, not hidden, and listed
 * nowhere (not in this Session, this Host, or a cached catalog). Only these can add a declared
 * tool after the first request.
 */
function serversWithUnknownApps(
  sessionId: string,
  servers: readonly McpServerEntry[],
  cached: CachedMcpAppTools | undefined,
) {
  return servers.filter(
    (server) =>
      server.config.enabled !== false &&
      (server.config.exposure ?? 'codemode') !== 'hidden' &&
      knownMcpAppTools(sessionId, server, cached) === undefined,
  )
}

/** Whether the server has listed its tools in this Session and Pi registered its App tools. */
function listedAndRegistered(
  registered: (label: string) => boolean,
  sessionId: string,
  server: McpServerEntry,
) {
  const apps = mcpAppToolNames(sessionId, server.name)
  if (!apps) return false
  return apps
    .filter((tool) => getMcpToolExposure(server.config, tool) !== 'hidden')
    .every((tool) => registered(`${server.name}/${tool}`))
}

/**
 * The first request of a Run waits, at most `waitMs`, for the servers whose App tools are not
 * known yet (a cold profile: no catalog, no earlier listing), so an App tool such a server offers
 * is declared from the first request instead of the second, and the declared tools do not change
 * between them (prompt cache). Known App tools already make Pi wait, as direct tools. The wait
 * stops for a server whose connection in this Session failed, or that a check or listing has seen
 * failing or signed out since the Run started (review R5 P2-2), so a broken server does not cost
 * every Run the whole bound.
 */
export function registerUnknownMcpAppToolWait(
  pi: ExtensionAPI,
  input: {
    readonly sessionId: string
    readonly servers: readonly McpServerEntry[]
    readonly cached?: CachedMcpAppTools
    readonly waitMs: number
    /** Whether Pi registered the MCP tool labelled `<server>/<tool>` in this session. */
    readonly registered: (label: string) => boolean
    /**
     * Whether the server's connection in this Session failed or closed since the Run leased it:
     * it will not list tools in this Run, so the wait stops for it.
     */
    readonly failed?: (server: McpServerEntry) => boolean
  },
) {
  let waiting: readonly McpServerEntry[] = []
  let startedAt = 0
  pi.on('session_start', () => {
    // Decided before the servers connect: what this Run knows when it starts.
    startedAt = Date.now()
    waiting = serversWithUnknownApps(input.sessionId, input.servers, input.cached)
  })
  pi.on('before_agent_start', async (_event, ctx) => {
    const servers = waiting
    waiting = []
    if (servers.length === 0) return
    const deadline = Date.now() + input.waitMs
    while (Date.now() < deadline && !ctx.signal?.aborted) {
      const settled = servers.every(
        (server) =>
          input.failed?.(server) === true ||
          unusableSince(server, startedAt) ||
          listedAndRegistered(input.registered, input.sessionId, server),
      )
      if (settled) return
      await sleep(POLL_INTERVAL_MS)
    }
  })
}

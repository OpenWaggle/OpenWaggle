import type {
  McpServerConnectionStateView,
  McpServerInspection,
} from '@shared/types/mcp-configuration'
import {
  type ListedMcpTool,
  mcpListCursor,
  mcpToolAppResourceUri,
  mcpToolListPage,
} from './mcp-tool-list-schema'

/**
 * The last known state of each MCP server, kept in memory by server identity so Settings > MCP
 * can show it on open without starting anything. A check ("Check connection", `openwaggle mcp
 * list`) records its result, and a Run's `tools/list` results passing through the transport layer
 * record the tools a connected server offers. Exposure is not kept: it follows the current
 * configuration, so it is applied when the state is read.
 */

export interface McpKnownTool {
  readonly name: string
  readonly title?: string
  readonly description?: string
  readonly hasApp: boolean
}

export interface McpKnownServerState {
  readonly state: McpServerConnectionStateView
  readonly tools: readonly McpKnownTool[]
  readonly error?: string
  readonly stderrTail?: string
  readonly checkedAt: number
}

/** Servers remembered at once; the oldest is forgotten first. */
const MAX_KNOWN_SERVERS = 512

const known = new Map<string, McpKnownServerState>()

function remember(identity: string, state: McpKnownServerState) {
  // Map order is insertion order, so re-inserting keeps the newest last.
  known.delete(identity)
  known.set(identity, state)
  while (known.size > MAX_KNOWN_SERVERS) {
    const oldest = known.keys().next().value
    if (oldest === undefined) return
    known.delete(oldest)
  }
}

function knownTool(tool: ListedMcpTool): McpKnownTool {
  return {
    name: tool.name,
    ...(tool.title === undefined ? {} : { title: tool.title }),
    ...(tool.description === undefined ? {} : { description: tool.description }),
    hasApp: mcpToolAppResourceUri(tool) !== undefined,
  }
}

/** Records the result of connecting to a server and listing its tools. */
export function recordMcpServerCheck(
  identity: string,
  inspection: McpServerInspection,
  now: number = Date.now(),
) {
  if (inspection.state === 'disabled') return
  remember(identity, {
    state: inspection.state,
    tools: inspection.tools.map((tool) => ({
      name: tool.name,
      ...(tool.title ? { title: tool.title } : {}),
      ...(tool.description ? { description: tool.description } : {}),
      hasApp: tool.hasApp,
    })),
    ...(inspection.error ? { error: inspection.error } : {}),
    ...(inspection.stderrTail ? { stderrTail: inspection.stderrTail } : {}),
    checkedAt: now,
  })
}

/**
 * Records one `tools/list` result page a Run received: the server is connected and offers these
 * tools. A page with a cursor continues the listing; one without starts it again.
 */
export function recordMcpServerToolsListing(
  identity: string,
  params: unknown,
  result: unknown,
  now: number = Date.now(),
) {
  const listed = mcpToolListPage(result)
  if (!listed) return
  const page = listed.tools.map(knownTool)
  const continues = mcpListCursor(params) !== undefined
  const previous = continues ? (known.get(identity)?.tools ?? []) : []
  remember(identity, { state: 'connected', tools: [...previous, ...page], checkedAt: now })
}

export function knownMcpServerState(identity: string) {
  return known.get(identity)
}

/** Forgets a server's state, for example after signing in or out changed what it would say. */
export function forgetKnownMcpServerState(identity: string) {
  known.delete(identity)
}

/** Forgets a server's state if it was learned by `time`: one learned later may be current. */
export function forgetKnownMcpServerStateLearnedBy(identity: string, time: number) {
  const state = known.get(identity)
  if (state && state.checkedAt <= time) known.delete(identity)
}

/** For tests: forgets every server. */
export function forgetKnownMcpServerStates() {
  known.clear()
}

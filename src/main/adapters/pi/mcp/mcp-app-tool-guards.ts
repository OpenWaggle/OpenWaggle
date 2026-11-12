/**
 * Whether an MCP App may call one of its server's tools. An App's call is the Session's own call,
 * so it is held to what a Run of the Session could call, and to what the server offers apps.
 */
import { getMcpToolExposure } from '@earendil-works/pi-coding-agent'
import { isRecord } from '@shared/utils/validation'
import { agentToolAllowlist } from '../../../domain/agents/agent-tool-allowlist'
import type { McpServerConfig } from '../../../domain/mcp/config/mcp-server-config'
import type { McpAppServerInput } from '../../../ports/mcp-app-runtime-service'
import {
  readSessionMcpServerAllowlist,
  readSessionToolAllowlist,
} from '../../../store/session-details/session-mcp-server-allowlist'
import { resolveLegacyMcpServerAllowlist } from './legacy-mcp-server-allowlist'
import { mcpToolVisibleToApps, recordMcpToolVisibility } from './mcp-app-registry'

/** How many `tools/list` pages an App's tool check reads before it gives up. */
const MCP_APP_TOOL_LIST_MAX_PAGES = 50

type AppToolCall = McpAppServerInput & { readonly toolName: string }

/** Pi's name of an MCP tool (`createMcpToolName` without a collision suffix). */
function piMcpToolName(serverName: string, toolName: string) {
  return `mcp__${serverName}__${toolName}`.replace(/[^A-Za-z0-9_]/g, '_')
}

/** The Session's Agent definition's tool allowlist, `mcp__…` patterns included. */
async function assertAgentAllows(input: AppToolCall) {
  const tools = await readSessionToolAllowlist(input.sessionId)
  if (!tools) return
  const mcpServers = await resolveLegacyMcpServerAllowlist(
    await readSessionMcpServerAllowlist(input.sessionId),
  )
  const name = piMcpToolName(input.serverName, input.toolName)
  if (!agentToolAllowlist({ tools, ...(mcpServers ? { mcpServers } : {}) })(name)) {
    throw new Error(`This Session's Agent definition does not allow the tool ${name}.`)
  }
}

/** Pages through `tools/list` until the tool shows up, recording each page's visibility. */
async function findAdvertisedTool(
  input: AppToolCall,
  listTools: (params: { readonly cursor?: string }) => Promise<unknown>,
) {
  let cursor: string | undefined
  for (let page = 0; page < MCP_APP_TOOL_LIST_MAX_PAGES; page += 1) {
    const listed = await listTools(cursor === undefined ? {} : { cursor })
    recordMcpToolVisibility(input.sessionId, input.serverName, listed)
    const tools = isRecord(listed) && Array.isArray(listed.tools) ? listed.tools : []
    if (tools.some((tool) => isRecord(tool) && tool.name === input.toolName)) return
    cursor =
      isRecord(listed) && typeof listed.nextCursor === 'string' ? listed.nextCursor : undefined
    if (cursor === undefined) break
  }
  throw new Error('The MCP App requested a tool that its server did not advertise.')
}

/**
 * Whether an App may call a tool: the Agent definition must allow it, the server must have
 * advertised it in this Session, its exposure must not be `hidden`, and its MCP Apps visibility
 * must include apps.
 */
export async function assertAppMayCall(
  config: McpServerConfig,
  input: AppToolCall,
  listTools: (params: { readonly cursor?: string }) => Promise<unknown>,
) {
  if (getMcpToolExposure(config, input.toolName) === 'hidden') {
    throw new Error(`The MCP tool "${input.toolName}" is hidden, so MCP Apps cannot call it.`)
  }
  await assertAgentAllows(input)
  let visible = mcpToolVisibleToApps(input.sessionId, input.serverName, input.toolName)
  if (visible === undefined) {
    await findAdvertisedTool(input, listTools)
    visible = mcpToolVisibleToApps(input.sessionId, input.serverName, input.toolName)
  }
  if (visible === false) {
    throw new Error(`The MCP tool "${input.toolName}" is not available to apps.`)
  }
}

import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import type { McpRuntimeConfig } from '../../mcp/config/mcp-runtime-config'
import { mcpServerIdentity } from '../../mcp/pool/mcp-connection-pool-api'
import { approveMcpToolCall } from './mcp-tool-approval'
import { mcpServerEntryOfNamespace, mcpToolNamespace } from './mcp-tool-server'

/** The configured server a Pi MCP tool belongs to, found through its tool namespace. */
function serverOfTool(
  pi: ExtensionAPI,
  config: Pick<McpRuntimeConfig, 'loaded'>,
  toolName: string,
) {
  const namespace = mcpToolNamespace(pi, toolName)
  if (!namespace) return undefined
  const server = mcpServerEntryOfNamespace(config, namespace)
  if (server) {
    return { name: server.name, identity: mcpServerIdentity(server.name, server.config) }
  }
  // A server an extension registered: still asked about, under its namespace.
  return { name: namespace.replace(/^mcp__/, ''), identity: `mcp-extension:${namespace}` }
}

/**
 * Asks before every MCP server tool runs, through Pi's `tool_call` hook, which also fires for the
 * calls a codemode script makes (`parentToolCallId` set).
 */
export function registerMcpToolApproval(
  pi: ExtensionAPI,
  config: Pick<McpRuntimeConfig, 'loaded'>,
) {
  pi.on('tool_call', async (event, ctx) => {
    if (!event.toolName.startsWith('mcp__')) return undefined
    const server = serverOfTool(pi, config, event.toolName)
    if (!server) return undefined
    const approved = await approveMcpToolCall({
      ctx,
      serverName: server.name,
      serverIdentity: server.identity,
      toolName: event.toolName,
      input: event.input,
      fromScript: event.parentToolCallId !== undefined,
    })
    return approved ? undefined : { block: true, reason: 'The user declined this MCP tool call.' }
  })
}

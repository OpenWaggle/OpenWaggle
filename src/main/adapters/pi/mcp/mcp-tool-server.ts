import { type ExtensionAPI, mcpNamespace } from '@earendil-works/pi-coding-agent'
import type { McpRuntimeConfig } from '../../mcp/config/mcp-runtime-config'

const MCP_TOOL_NAME = /^mcp__(.+?)__/

/** The tool namespace (`mcp__<server>`) of a Pi MCP tool, from Pi's registry or its name. */
export function mcpToolNamespace(pi: ExtensionAPI, toolName: string) {
  const registered = pi.getAllTools().find((tool) => tool.name === toolName)?.namespace?.name
  if (registered) return registered
  const server = MCP_TOOL_NAME.exec(toolName)?.[1]
  return server ? `mcp__${server}` : undefined
}

/** The configured server entry behind a namespace; undefined for a server an extension added. */
export function mcpServerEntryOfNamespace(
  config: Pick<McpRuntimeConfig, 'loaded'>,
  namespace: string,
) {
  return config.loaded.servers.find((entry) => mcpNamespace(entry.name) === namespace)
}

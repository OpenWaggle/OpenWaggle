import type {
  McpConfigurationView,
  McpConfiguredServerView,
  McpServerInspection,
} from '@shared/types/mcp-configuration'

/**
 * A server's state as `openwaggle mcp list` and `doctor` print it, worded as Settings words it. A
 * server that is on but reads a vault secret that is not saved is left out of every Run until it
 * is added: it needs that secret, which is not a failure to connect.
 */
export const MCP_NEEDS_SECRET_STATE = 'needs-secret'

export const MCP_NEEDS_SECRET_HINT = 'add the secret under Settings > MCP > Secrets'

export function mcpCliServerState(
  server: McpConfiguredServerView,
  inspection: McpServerInspection | undefined,
  view: Pick<McpConfigurationView, 'missingSecretServers'>,
) {
  if (server.enabled && view.missingSecretServers?.includes(server.name)) {
    return MCP_NEEDS_SECRET_STATE
  }
  return inspection?.state ?? 'disabled'
}

export function mcpCliStateLabel(state: string, toolCount: number) {
  if (state === 'connected')
    return `connected, ${String(toolCount)} tool${toolCount === 1 ? '' : 's'}`
  if (state === 'needs-sign-in') return 'needs sign-in'
  return state === MCP_NEEDS_SECRET_STATE ? 'needs secret' : state
}

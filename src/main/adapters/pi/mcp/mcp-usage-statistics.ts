import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import type { McpRuntimeConfig } from '../../mcp/config/mcp-runtime-config'
import { observePiMcpServerUseForUsageStatistics } from '../pi-usage-statistics'
import { mcpServerEntryOfNamespace, mcpToolNamespace } from './mcp-tool-server'

/**
 * Counts the MCP servers a Run's tools reach, codemode child calls included, for Usage
 * statistics. The server's configuration is read here, when the call starts, so a server of the
 * user's own that only shares a catalog name is counted as `custom`.
 */
export function registerMcpUsageStatistics(
  pi: ExtensionAPI,
  config: Pick<McpRuntimeConfig, 'loaded'>,
) {
  pi.on('tool_execution_start', (event) => {
    if (!event.toolName.startsWith('mcp__')) return
    const namespace = mcpToolNamespace(pi, event.toolName)
    if (!namespace) return
    const entry = mcpServerEntryOfNamespace(config, namespace)
    observePiMcpServerUseForUsageStatistics(
      entry
        ? {
            name: entry.name,
            launch:
              'url' in entry.config
                ? { url: entry.config.url }
                : {
                    command: entry.config.command,
                    ...(entry.config.args ? { args: entry.config.args } : {}),
                  },
          }
        : { name: namespace.slice('mcp__'.length), launch: undefined },
    )
  })
}

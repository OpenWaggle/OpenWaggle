import type { AgentFeature, AgentPromptFragment } from '../agent/runtime-types'
import { mcpManager } from './mcp-manager'

const mcpPromptFragment: AgentPromptFragment = {
  id: 'mcp.capabilities',
  order: 50,
  build: () => {
    const statuses = mcpManager.getServerStatuses()
    const connected = statuses.filter((s) => s.status === 'connected')
    if (connected.length === 0) return ''

    const lines = [
      'You have access to MCP (Model Context Protocol) tools from the following servers:\n',
    ]
    for (const server of connected) {
      lines.push(`## ${server.name} (${server.toolCount} tools)`)
      for (const tool of server.tools) {
        lines.push(`- ${tool.namespacedName}: ${tool.description}`)
      }
      lines.push('')
    }

    lines.push(
      'MCP tools are prefixed with the server name (e.g. server__toolName). ' +
        'All MCP tool calls require user approval before execution.',
    )

    return lines.join('\n')
  },
}

export const mcpToolsFeature: AgentFeature = {
  id: 'mcp.tools',
  isEnabled: () => mcpManager.hasConnectedServers(),
  getPromptFragments: () => [mcpPromptFragment],
  getTools: () => mcpManager.getServerTools(),
}

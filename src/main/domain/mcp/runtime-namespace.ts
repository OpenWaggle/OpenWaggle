import type { McpTurnSnapshot } from '@shared/types/mcp'

const MCP_MANAGEMENT_RUNTIME_NAMESPACE_PREFIX = 'mcp-management'

export function createMcpManagementRuntimeNamespace(input: {
  readonly projectPath: string
  readonly sessionId?: string | null
}) {
  const scope = input.sessionId?.trim() || input.projectPath
  return `${MCP_MANAGEMENT_RUNTIME_NAMESPACE_PREFIX}:${scope}`
}

export function resolveMcpRuntimeNamespace(snapshot: McpTurnSnapshot) {
  return snapshot.runtimeNamespace ?? snapshot.sessionId
}

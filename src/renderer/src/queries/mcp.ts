import type { McpServerId } from '@shared/types/brand'
import type { McpServerConfig } from '@shared/types/mcp'
import { queryOptions } from '@tanstack/react-query'
import { api } from '@/lib/ipc'
import { queryKeys } from './query-keys'

export function mcpServersQueryOptions() {
  return queryOptions({
    queryKey: queryKeys.mcpServers,
    queryFn: () => api.listMcpServers(),
  })
}

function describeMcpMutationError(error: unknown, fallback: string): Error {
  if (error instanceof Error && error.message.trim()) {
    return error
  }
  if (typeof error === 'string' && error.trim()) {
    return new Error(error)
  }

  return new Error(fallback)
}

export async function addMcpServerOrThrow(config: Omit<McpServerConfig, 'id'>) {
  const result = await api.addMcpServer(config)
  if (!result.ok) {
    throw describeMcpMutationError(result.error, 'Failed to add MCP server.')
  }
  return result
}

export async function removeMcpServerOrThrow(id: McpServerId) {
  const result = await api.removeMcpServer(id)
  if (!result.ok) {
    throw describeMcpMutationError(result.error, 'Failed to remove MCP server.')
  }
  return result
}

export async function toggleMcpServerOrThrow(id: McpServerId, enabled: boolean) {
  const result = await api.toggleMcpServer(id, enabled)
  if (!result.ok) {
    throw describeMcpMutationError(result.error, 'Failed to update MCP server.')
  }
  return result
}

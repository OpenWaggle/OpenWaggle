import type { McpServerId } from '@shared/types/brand'
import type { McpServerConfig, McpServerStatus } from '@shared/types/mcp'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { api } from '@/lib/ipc'
import {
  addMcpServerOrThrow,
  mcpServersQueryOptions,
  removeMcpServerOrThrow,
  toggleMcpServerOrThrow,
} from '@/queries/mcp'
import { queryKeys } from '@/queries/query-keys'

interface UseMcpResult {
  readonly servers: readonly McpServerStatus[]
  readonly isLoading: boolean
  readonly loadError: string | null
  readonly actionError: string | null
  readonly isAddFormOpen: boolean
  readonly setAddFormOpen: (open: boolean) => void
  readonly addServer: (
    config: Omit<McpServerConfig, 'id'>,
  ) => Promise<{ ok: boolean; error?: string }>
  readonly removeServer: (id: McpServerId) => Promise<void>
  readonly toggleServer: (id: McpServerId, enabled: boolean) => Promise<void>
  readonly refresh: () => Promise<void>
}

export function useMcp(): UseMcpResult {
  const queryClient = useQueryClient()
  const [isAddFormOpen, setAddFormOpen] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)

  const serversQuery = useQuery(mcpServersQueryOptions())

  const addServerMutation = useMutation({
    mutationFn: (config: Omit<McpServerConfig, 'id'>) => addMcpServerOrThrow(config),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.mcpServers, exact: true })
      setAddFormOpen(false)
    },
  })

  const removeServerMutation = useMutation({
    mutationFn: (id: McpServerId) => removeMcpServerOrThrow(id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.mcpServers, exact: true })
    },
  })

  const toggleServerMutation = useMutation({
    mutationFn: ({ id, enabled }: { readonly id: McpServerId; readonly enabled: boolean }) =>
      toggleMcpServerOrThrow(id, enabled),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.mcpServers, exact: true })
    },
  })

  useEffect(() => {
    const unsubscribe = api.onMcpStatusChanged((status) => {
      queryClient.setQueryData<readonly McpServerStatus[]>(queryKeys.mcpServers, (current) => {
        const previous = current ?? []
        const index = previous.findIndex((server) => server.id === status.id)
        if (index < 0) {
          return [...previous, status]
        }
        return previous.map((server, currentIndex) => (currentIndex === index ? status : server))
      })
    })

    return unsubscribe
  }, [queryClient])

  async function refresh(): Promise<void> {
    setActionError(null)
    addServerMutation.reset()
    removeServerMutation.reset()
    toggleServerMutation.reset()
    await queryClient.invalidateQueries({ queryKey: queryKeys.mcpServers, exact: true })
  }

  async function addServer(
    config: Omit<McpServerConfig, 'id'>,
  ): Promise<{ ok: boolean; error?: string }> {
    setActionError(null)
    addServerMutation.reset()
    removeServerMutation.reset()
    toggleServerMutation.reset()
    try {
      await addServerMutation.mutateAsync(config)
      return { ok: true }
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : 'Failed to add MCP server.',
      }
    }
  }

  async function removeServer(id: McpServerId): Promise<void> {
    setActionError(null)
    addServerMutation.reset()
    removeServerMutation.reset()
    toggleServerMutation.reset()
    try {
      await removeServerMutation.mutateAsync(id)
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Failed to update MCP servers.')
      return
    }
  }

  async function toggleServer(id: McpServerId, enabled: boolean): Promise<void> {
    setActionError(null)
    addServerMutation.reset()
    removeServerMutation.reset()
    toggleServerMutation.reset()
    try {
      await toggleServerMutation.mutateAsync({ id, enabled })
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Failed to update MCP servers.')
      return
    }
  }

  const loadError =
    serversQuery.error instanceof Error ? serversQuery.error.message : 'Failed to load MCP servers'

  return {
    servers: serversQuery.data ?? [],
    isLoading: serversQuery.isPending,
    loadError: serversQuery.error ? loadError : null,
    actionError,
    isAddFormOpen,
    setAddFormOpen,
    addServer,
    removeServer,
    toggleServer,
    refresh,
  }
}

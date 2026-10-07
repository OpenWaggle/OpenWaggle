import type {
  McpRegistryInstallRequest,
  McpRegistryInstallResultView,
} from '@shared/types/mcp-registry'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { mcpConfigurationQueryOptions, mcpQueryKeys } from '@/queries/mcp-configuration'
import { mcpRegistrySearchQueryOptions } from '@/queries/mcp-registry'
import { api } from '@/shared/lib/ipc'
import { ipcErrorMessage } from '@/shared/lib/ipc-error-message'

/**
 * MCP Registry search and install for Settings > MCP. An install saves an ordinary entry to
 * OpenWaggle's MCP file, so the server list shows it like any other server.
 */
export function useMcpRegistry(projectPath: string | null) {
  const queryClient = useQueryClient()
  const [query, setQuery] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [installed, setInstalled] = useState<McpRegistryInstallResultView | null>(null)
  const search = useQuery(mcpRegistrySearchQueryOptions(query))
  const configuration = useQuery(mcpConfigurationQueryOptions(projectPath))
  const install = useMutation({
    mutationFn: (request: Omit<McpRegistryInstallRequest, 'projectPath'>) =>
      api.installMcpRegistryServer({ projectPath, ...request }),
    onMutate: () => {
      setError(null)
      setInstalled(null)
    },
    onError: (failure) => setError(ipcErrorMessage(failure)),
    onSuccess: async (result) => {
      setInstalled(result)
      queryClient.setQueryData(mcpQueryKeys.configuration(projectPath), result.view)
      await queryClient.invalidateQueries({
        queryKey: mcpQueryKeys.inspections(projectPath, result.name),
      })
    },
  })
  return {
    query,
    search: (next: string) => setQuery(next.trim()),
    servers: search.data?.servers ?? null,
    isSearching: search.isFetching,
    searchError: search.error ? ipcErrorMessage(search.error) : null,
    configuredNames: new Set((configuration.data?.servers ?? []).map((server) => server.name)),
    install: install.mutate,
    installing: install.isPending ? (install.variables?.registryName ?? null) : null,
    installed,
    error,
  }
}

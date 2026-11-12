import { queryOptions } from '@tanstack/react-query'
import { api } from '@/shared/lib/ipc'

/** MCP Registry searches, run by the Session Host. Results change rarely within a session. */

const REGISTRY_SEARCH_STALE_MS = 5 * 60_000

export const mcpRegistryQueryKeys = {
  search: (query: string) => ['mcpRegistrySearch', query] as const,
}

export function mcpRegistrySearchQueryOptions(query: string) {
  return queryOptions({
    queryKey: mcpRegistryQueryKeys.search(query),
    queryFn: () => api.searchMcpRegistry({ query }),
    enabled: query.length > 0,
    staleTime: REGISTRY_SEARCH_STALE_MS,
    retry: false,
  })
}

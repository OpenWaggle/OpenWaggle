import type { McpRegistrySearchResultView } from '@shared/types/mcp-registry'
import { queryOptions } from '@tanstack/react-query'
import { api } from '@/shared/lib/ipc'
import type { OpenWaggleQueryOptions } from './query-options'

/** MCP Registry searches, run by the Session Host. Results change rarely within a session. */

const REGISTRY_SEARCH_STALE_MS = 5 * 60_000

export const mcpRegistryQueryKeys = {
  search: (query: string) => ['mcpRegistrySearch', query] as const,
}

export function mcpRegistrySearchQueryOptions(
  query: string,
): OpenWaggleQueryOptions<
  McpRegistrySearchResultView,
  Error,
  McpRegistrySearchResultView,
  ReturnType<typeof mcpRegistryQueryKeys.search>
> {
  return queryOptions({
    queryKey: mcpRegistryQueryKeys.search(query),
    queryFn: () => api.searchMcpRegistry({ query }),
    enabled: query.length > 0,
    staleTime: REGISTRY_SEARCH_STALE_MS,
    retry: false,
  })
}

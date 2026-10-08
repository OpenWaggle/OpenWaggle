import type {
  ChangeRequestOpenDestinationResolution,
  SourceControlConfigureRequest,
  SourceControlConfigureResult,
  SourceControlHostsOverview,
} from '@shared/types/git'
import { type QueryClient, queryOptions, useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { api } from '@/shared/lib/ipc'
import { queryKeys } from './query-keys'
import type { OpenWaggleQueryOptions } from './query-options'

export function sourceControlHostsQueryOptions(): OpenWaggleQueryOptions<
  SourceControlHostsOverview,
  Error,
  SourceControlHostsOverview,
  typeof queryKeys.sourceControlHosts
> {
  return queryOptions({
    queryKey: queryKeys.sourceControlHosts,
    queryFn: () => api.getSourceControlHosts(),
  })
}

/** The effective Change request open destination; the Session Host resolves every level. */
export function changeRequestOpenDestinationQueryOptions(
  projectPath: string | null,
): OpenWaggleQueryOptions<
  ChangeRequestOpenDestinationResolution,
  Error,
  ChangeRequestOpenDestinationResolution,
  ReturnType<typeof queryKeys.changeRequestOpenDestination>
> {
  return queryOptions({
    queryKey: queryKeys.changeRequestOpenDestination(projectPath),
    queryFn: () => api.getChangeRequestOpenDestination(projectPath),
  })
}

/**
 * Applies one source-control configuration change, then refreshes everything it can change:
 * hosts, open destinations, and any open Change request inspector. VCS status is not a query;
 * callers that show it refresh it themselves.
 */
export async function configureSourceControl(
  queryClient: QueryClient,
  request: SourceControlConfigureRequest,
): Promise<SourceControlConfigureResult> {
  const result = await api.configureSourceControl(request)
  if (result.ok) {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.sourceControl }),
      queryClient.invalidateQueries({ queryKey: queryKeys.changeRequestPanels }),
    ])
  }
  return result
}

interface FreshnessSubscription {
  consumers: number
  stop: () => void
}

const freshnessSubscriptions = new WeakMap<QueryClient, FreshnessSubscription>()

function subscribeFreshness(queryClient: QueryClient) {
  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.sourceControl })
  }
  // The agent's source_control tool can change hosts and destinations during a Run, and signing
  // in happens in a terminal or browser outside the window.
  const stopRuns = typeof api.onRunCompleted === 'function' ? api.onRunCompleted(invalidate) : null
  window.addEventListener('focus', invalidate)
  return () => {
    stopRuns?.()
    window.removeEventListener('focus', invalidate)
  }
}

/**
 * Keeps source-control hosts and open destinations fresh: they are re-read when a Run completes
 * and when the window regains focus. Consumers share one subscription per query client.
 */
export function useSourceControlQueryFreshness() {
  const queryClient = useQueryClient()
  useEffect(() => {
    const existing = freshnessSubscriptions.get(queryClient)
    if (existing) existing.consumers += 1
    else
      freshnessSubscriptions.set(queryClient, {
        consumers: 1,
        stop: subscribeFreshness(queryClient),
      })
    return () => {
      const subscription = freshnessSubscriptions.get(queryClient)
      if (!subscription) return
      subscription.consumers -= 1
      if (subscription.consumers > 0) return
      subscription.stop()
      freshnessSubscriptions.delete(queryClient)
    }
  }, [queryClient])
}

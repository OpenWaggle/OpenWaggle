import type { UsageCostQuery, UsageCostSessionQuery } from '@shared/types/usage-cost'
import { queryOptions } from '@tanstack/react-query'
import { api } from '@/shared/lib/ipc'

/** Usage & Cost view data, scanned from Pi session records on demand. */

const VIEW_REFRESH_INTERVAL_MS = 60_000

export const usageCostQueryKeys = {
  view: (query: UsageCostQuery) => ['usageCostView', query] as const,
  sessions: (query: UsageCostSessionQuery) => ['usageCostSessions', query] as const,
}

export function usageCostViewQueryOptions(query: UsageCostQuery) {
  return queryOptions({
    queryKey: usageCostQueryKeys.view(query),
    queryFn: () => api.getUsageCostView(query),
    // Totals are never older than the moment the view opened; a visible
    // re-check keeps an open page fresh without any background scanning.
    refetchInterval: VIEW_REFRESH_INTERVAL_MS,
    refetchIntervalInBackground: false,
  })
}

export function usageCostSessionsQueryOptions(query: UsageCostSessionQuery) {
  return queryOptions({
    queryKey: usageCostQueryKeys.sessions(query),
    queryFn: () => api.getUsageCostSessions(query),
  })
}

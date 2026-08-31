import { SessionId } from '@shared/types/brand'
import type {
  SessionResource,
  SessionResourceContent,
  SessionResourceList,
} from '@shared/types/session-resource'
import { queryOptions, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import type { OpenWaggleQueryOptions } from '@/queries/query-options'
import { api } from '@/shared/lib/ipc'

type SessionResourcesQueryKey = readonly ['session-resources', string]
type SessionResourceContentQueryKey = readonly ['session-resource-content', string, string]
type SessionResourceThumbnailQueryKey = readonly ['session-resource-thumbnail', string, string]

const SESSION_RESOURCE_BACKFILL_POLL_INTERVAL_MS = 100
const SESSION_RESOURCE_THUMBNAIL_RETRY_INTERVAL_MS = 1_000

export const sessionResourcesQueryKey = (sessionId: string): SessionResourcesQueryKey =>
  ['session-resources', sessionId] as const

export const sessionResourceThumbnailQueryKey = (
  sessionId: string,
  resourceId: string,
): SessionResourceThumbnailQueryKey =>
  ['session-resource-thumbnail', sessionId, resourceId] as const

export function sessionResourcesQueryOptions(
  sessionId: string | null,
): OpenWaggleQueryOptions<SessionResourceList, Error, SessionResource[], SessionResourcesQueryKey> {
  return queryOptions({
    queryKey: sessionResourcesQueryKey(sessionId ?? 'none'),
    queryFn: async () => {
      if (!sessionId) return { resources: [], backfillComplete: true }
      const result = await api.listSessionResources(SessionId(sessionId))
      return Array.isArray(result) ? { resources: result, backfillComplete: true } : result
    },
    select: (result) => result.resources,
    refetchInterval: (query) =>
      query.state.data?.backfillComplete === false
        ? SESSION_RESOURCE_BACKFILL_POLL_INTERVAL_MS
        : false,
  })
}

export function sessionResourceContentQueryOptions(
  sessionId: string,
  resourceId: string,
): OpenWaggleQueryOptions<
  SessionResourceContent | null,
  Error,
  SessionResourceContent | null,
  SessionResourceContentQueryKey
> {
  return queryOptions({
    queryKey: ['session-resource-content', sessionId, resourceId] as const,
    queryFn: () => api.readSessionResource(SessionId(sessionId), resourceId),
    gcTime: 0,
    staleTime: Number.POSITIVE_INFINITY,
  })
}

export function sessionResourceThumbnailQueryOptions(
  sessionId: string,
  resourceId: string,
): OpenWaggleQueryOptions<
  SessionResourceContent | null,
  Error,
  SessionResourceContent | null,
  SessionResourceThumbnailQueryKey
> {
  return queryOptions({
    queryKey: sessionResourceThumbnailQueryKey(sessionId, resourceId),
    queryFn: () => api.readSessionResourceThumbnail(SessionId(sessionId), resourceId),
    staleTime: Number.POSITIVE_INFINITY,
    refetchInterval: (query) =>
      query.state.data === null ? SESSION_RESOURCE_THUMBNAIL_RETRY_INTERVAL_MS : false,
  })
}

export function useSessionResources(sessionId: string | null) {
  return useQuery({
    ...sessionResourcesQueryOptions(sessionId),
    enabled: sessionId !== null,
  })
}

export function useSessionResourceRunCompletion(sessionId: string | null) {
  const queryClient = useQueryClient()
  useEffect(() => {
    if (!sessionId || typeof api.onRunCompleted !== 'function') return
    return api.onRunCompleted((payload) => {
      if (String(payload.sessionId) !== sessionId) return
      void queryClient.invalidateQueries({ queryKey: sessionResourcesQueryKey(sessionId) })
    })
  }, [queryClient, sessionId])
}

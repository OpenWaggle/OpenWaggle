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
type SessionResourceContentQueryKey = readonly ['session-resource-content', string, string, number]
type SessionResourceThumbnailQueryKey = readonly [
  'session-resource-thumbnail',
  string,
  string,
  number,
]

const SESSION_RESOURCE_BACKFILL_POLL_INTERVAL_MS = 100
const SESSION_RESOURCE_THUMBNAIL_RETRY_INTERVAL_MS = 1_000
const SESSION_RESOURCE_THUMBNAIL_MAX_ATTEMPTS = 3

export const sessionResourcesQueryKey = (sessionId: string): SessionResourcesQueryKey =>
  ['session-resources', sessionId] as const

export const sessionResourceThumbnailQueryKey = (sessionId: string, resourceId: string) =>
  ['session-resource-thumbnail', sessionId, resourceId] as const

function versionedSessionResourceThumbnailQueryKey(
  sessionId: string,
  resourceId: string,
  resourceRevision: number,
): SessionResourceThumbnailQueryKey {
  return ['session-resource-thumbnail', sessionId, resourceId, resourceRevision]
}

export function sessionResourcesQueryOptions(
  sessionId: string | null,
): OpenWaggleQueryOptions<SessionResourceList, Error, SessionResource[], SessionResourcesQueryKey> {
  return queryOptions({
    queryKey: sessionResourcesQueryKey(sessionId ?? 'none'),
    queryFn: async ({ client, queryKey }) => {
      if (!sessionId) return { resources: [], backfillComplete: true }
      const previous = client.getQueryData<SessionResourceList>(queryKey)
      if (previous?.backfillComplete === false) {
        const status = await api.advanceSessionResourceBackfill(SessionId(sessionId))
        if (!status.backfillComplete) return previous
      }
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
  resourceRevision: number,
): OpenWaggleQueryOptions<
  SessionResourceContent | null,
  Error,
  SessionResourceContent | null,
  SessionResourceContentQueryKey
> {
  return queryOptions({
    queryKey: ['session-resource-content', sessionId, resourceId, resourceRevision] as const,
    queryFn: () => api.readSessionResource(SessionId(sessionId), resourceId),
    gcTime: 0,
    staleTime: Number.POSITIVE_INFINITY,
  })
}

export function sessionResourceThumbnailQueryOptions(
  sessionId: string,
  resourceId: string,
  resourceRevision: number,
): OpenWaggleQueryOptions<
  SessionResourceContent | null,
  Error,
  SessionResourceContent | null,
  SessionResourceThumbnailQueryKey
> {
  return queryOptions({
    queryKey: versionedSessionResourceThumbnailQueryKey(sessionId, resourceId, resourceRevision),
    queryFn: () => api.readSessionResourceThumbnail(SessionId(sessionId), resourceId),
    staleTime: Number.POSITIVE_INFINITY,
    refetchInterval: (query) =>
      query.state.data === null &&
      query.state.dataUpdateCount < SESSION_RESOURCE_THUMBNAIL_MAX_ATTEMPTS
        ? SESSION_RESOURCE_THUMBNAIL_RETRY_INTERVAL_MS
        : false,
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

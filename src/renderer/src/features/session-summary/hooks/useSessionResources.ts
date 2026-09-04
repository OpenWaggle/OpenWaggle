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
const SESSION_RESOURCE_BACKFILL_MAX_POLL_INTERVAL_MS = 2_000
const SESSION_RESOURCE_BACKFILL_MAX_STALLED_ATTEMPTS = 5
const SESSION_RESOURCE_BACKFILL_DELAY_MULTIPLIER = 2
const SESSION_RESOURCE_QUERY_RETRY_ATTEMPTS = 3
const SESSION_RESOURCE_THUMBNAIL_RETRY_INTERVAL_MS = 1_000
const SESSION_RESOURCE_THUMBNAIL_MAX_ATTEMPTS = 3

class SessionResourceBackfillStalledError extends Error {}

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
): OpenWaggleQueryOptions<
  SessionResourceQueryState,
  Error,
  SessionResource[],
  SessionResourcesQueryKey
> {
  return queryOptions({
    queryKey: sessionResourcesQueryKey(sessionId ?? 'none'),
    queryFn: async ({ client, queryKey }) => {
      if (!sessionId) return { resources: [], backfillComplete: true, stalledAttempts: 0 }
      const previous = client.getQueryData<SessionResourceQueryState>(queryKey)
      if (previous?.backfillComplete === false) {
        const status = await api.advanceSessionResourceBackfill(SessionId(sessionId))
        if (!status.backfillComplete) {
          const stalledAttempts = status.progressed ? 0 : previous.stalledAttempts + 1
          if (stalledAttempts >= SESSION_RESOURCE_BACKFILL_MAX_STALLED_ATTEMPTS) {
            throw new SessionResourceBackfillStalledError(
              'Historical session resource indexing stalled. Retry to continue.',
            )
          }
          return { ...previous, stalledAttempts }
        }
      }
      const result: SessionResourceList | SessionResource[] = await api.listSessionResources(
        SessionId(sessionId),
      )
      const normalized: SessionResourceList = Array.isArray(result)
        ? { resources: result, backfillComplete: true }
        : result
      return {
        ...normalized,
        stalledAttempts: 0,
      }
    },
    select: (result) => result.resources,
    retry: (failureCount, error) =>
      !(error instanceof SessionResourceBackfillStalledError) &&
      failureCount < SESSION_RESOURCE_QUERY_RETRY_ATTEMPTS,
    refetchInterval: (query) => {
      if (query.state.status === 'error' || query.state.data?.backfillComplete !== false) {
        return false
      }
      const stalledAttempts = query.state.data.stalledAttempts
      return Math.min(
        SESSION_RESOURCE_BACKFILL_POLL_INTERVAL_MS *
          SESSION_RESOURCE_BACKFILL_DELAY_MULTIPLIER ** stalledAttempts,
        SESSION_RESOURCE_BACKFILL_MAX_POLL_INTERVAL_MS,
      )
    },
  })
}

interface SessionResourceQueryState extends SessionResourceList {
  readonly stalledAttempts: number
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

export function useSessionResourceRunCompletion(_sessionId: string | null) {
  const queryClient = useQueryClient()
  useEffect(() => {
    const invalidate = (payload: { readonly sessionId: SessionId }) => {
      void queryClient.invalidateQueries({
        queryKey: sessionResourcesQueryKey(String(payload.sessionId)),
      })
    }
    const cleanups = [
      typeof api.onRunCompleted === 'function' ? api.onRunCompleted(invalidate) : undefined,
      typeof api.onSessionResourcesInvalidated === 'function'
        ? api.onSessionResourcesInvalidated(invalidate)
        : undefined,
    ]
    return () => {
      for (const cleanup of cleanups) cleanup?.()
    }
  }, [queryClient])
}

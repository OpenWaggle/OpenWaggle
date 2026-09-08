import { SessionId } from '@shared/types/brand'
import type {
  SessionResource,
  SessionResourceBackfillStatus,
  SessionResourceContent,
  SessionResourceList,
  SessionResourceThumbnailPreview,
} from '@shared/types/session-resource'
import { type QueryClient, queryOptions, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import type { OpenWaggleQueryOptions } from '@/queries/query-options'
import { api } from '@/shared/lib/ipc'

export { useSessionImageResourcesByNodeIds } from './useSessionMessageResources'
export {
  sessionResourceCatalogQueryKey,
  useSessionImageLocation,
  useSessionResource,
  useSessionResourceCatalog,
} from './useSessionResourceCatalog'

type SessionResourcesQueryKey = readonly ['session-resources', string]
type SessionResourceBackfillQueryKey = readonly ['session-resource-backfill', string]
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
const SESSION_RESOURCE_THUMBNAIL_RETRY_INTERVAL_MS = 1_000
const SESSION_RESOURCE_THUMBNAIL_MAX_ATTEMPTS = 3

class SessionResourceBackfillStalledError extends Error {}

interface SessionResourceBackfillState extends SessionResourceBackfillStatus {
  readonly stalledAttempts: number
}

export const sessionResourcesQueryKey = (sessionId: string): SessionResourcesQueryKey =>
  ['session-resources', sessionId] as const

export function invalidateSessionResourceQueries(queryClient: QueryClient, sessionId: string) {
  return queryClient.invalidateQueries({
    predicate: (query) => {
      const [scope, candidateSessionId] = query.queryKey
      return (
        candidateSessionId === sessionId &&
        (scope === 'session-resources' ||
          scope === 'session-resource-catalog' ||
          scope === 'session-resource-exact' ||
          scope === 'session-resource-image-location' ||
          scope === 'session-resource-nodes')
      )
    },
  })
}

export function useSessionResourceBackfill(sessionId: string | null) {
  const queryClient = useQueryClient()
  const query = useQuery(sessionResourceBackfillQueryOptions(sessionId))
  const progressedAt = query.data?.progressed ? query.dataUpdatedAt : 0
  useEffect(() => {
    if (!sessionId || progressedAt === 0) return
    void invalidateSessionResourceQueries(queryClient, sessionId)
  }, [progressedAt, queryClient, sessionId])
  return query
}

export function sessionResourceBackfillQueryOptions(
  sessionId: string | null,
): OpenWaggleQueryOptions<
  SessionResourceBackfillState,
  Error,
  SessionResourceBackfillState,
  SessionResourceBackfillQueryKey
> {
  return queryOptions({
    queryKey: ['session-resource-backfill', sessionId ?? 'none'] as const,
    queryFn: async ({ client, queryKey }): Promise<SessionResourceBackfillState> => {
      if (!sessionId) return { backfillComplete: true, progressed: false, stalledAttempts: 0 }
      const previous = client.getQueryData<SessionResourceBackfillState>(queryKey)
      const status = await api.advanceSessionResourceBackfill(SessionId(sessionId))
      const stalledAttempts =
        status.backfillComplete || status.progressed ? 0 : (previous?.stalledAttempts ?? 0) + 1
      if (stalledAttempts >= SESSION_RESOURCE_BACKFILL_MAX_STALLED_ATTEMPTS) {
        throw new SessionResourceBackfillStalledError(
          'Historical session resource indexing stalled. Retry to continue.',
        )
      }
      return { ...status, stalledAttempts }
    },
    enabled: sessionId !== null,
    refetchInterval: (current) => {
      if (current.state.status === 'error' || current.state.data?.backfillComplete !== false) {
        return false
      }
      return Math.min(
        SESSION_RESOURCE_BACKFILL_POLL_INTERVAL_MS *
          SESSION_RESOURCE_BACKFILL_DELAY_MULTIPLIER ** current.state.data.stalledAttempts,
        SESSION_RESOURCE_BACKFILL_MAX_POLL_INTERVAL_MS,
      )
    },
  })
}

interface SessionResourceQueryState extends SessionResourceList {
  readonly stalledAttempts: number
}

function normalizeSessionResourceList(
  result: SessionResourceList | SessionResource[],
): SessionResourceList {
  return 'resources' in result ? result : { resources: result, backfillComplete: true }
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
      return { ...normalizeSessionResourceList(result), stalledAttempts: 0 }
    },
    select: (result) => result.resources,
    refetchInterval: (query) => {
      if (query.state.status === 'error' || query.state.data?.backfillComplete !== false)
        return false
      return Math.min(
        SESSION_RESOURCE_BACKFILL_POLL_INTERVAL_MS *
          SESSION_RESOURCE_BACKFILL_DELAY_MULTIPLIER ** query.state.data.stalledAttempts,
        SESSION_RESOURCE_BACKFILL_MAX_POLL_INTERVAL_MS,
      )
    },
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

export const sessionResourceThumbnailQueryKey = (sessionId: string, resourceId: string) =>
  ['session-resource-thumbnail', sessionId, resourceId] as const

export function sessionResourceThumbnailQueryOptions(
  sessionId: string,
  resourceId: string,
  resourceRevision: number,
): OpenWaggleQueryOptions<
  SessionResourceThumbnailPreview | null,
  Error,
  SessionResourceThumbnailPreview | null,
  SessionResourceThumbnailQueryKey
> {
  return queryOptions({
    queryKey: ['session-resource-thumbnail', sessionId, resourceId, resourceRevision] as const,
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
  return useQuery({ ...sessionResourcesQueryOptions(sessionId), enabled: sessionId !== null })
}

export function useSessionResourceInvalidation(sessionId: string | null) {
  const queryClient = useQueryClient()
  useEffect(() => {
    if (!sessionId || typeof api.onSessionResourcesInvalidated !== 'function') return
    return api.onSessionResourcesInvalidated((payload) => {
      if (String(payload.sessionId) !== sessionId) return
      void invalidateSessionResourceQueries(queryClient, sessionId)
    })
  }, [queryClient, sessionId])
}

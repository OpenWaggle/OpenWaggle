import { SessionId } from '@shared/types/brand'
import type { SessionResource, SessionResourceContent } from '@shared/types/session-resource'
import { queryOptions, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import type { OpenWaggleQueryOptions } from '@/queries/query-options'
import { api } from '@/shared/lib/ipc'

type SessionResourcesQueryKey = readonly ['session-resources', string]
type SessionResourceContentQueryKey = readonly ['session-resource-content', string, string]

export const sessionResourcesQueryKey = (sessionId: string): SessionResourcesQueryKey =>
  ['session-resources', sessionId] as const

export function sessionResourcesQueryOptions(
  sessionId: string | null,
): OpenWaggleQueryOptions<SessionResource[], Error, SessionResource[], SessionResourcesQueryKey> {
  return queryOptions({
    queryKey: sessionResourcesQueryKey(sessionId ?? 'none'),
    queryFn: () =>
      sessionId ? api.listSessionResources(SessionId(sessionId)) : Promise.resolve([]),
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
    staleTime: Number.POSITIVE_INFINITY,
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

import type { SessionBranchId, SessionId } from '@shared/types/brand'
import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/shared/lib/ipc'
import { queryKeys } from './query-keys'
import type { OpenWaggleQueryOptions } from './query-options'

type ArchivedSessions = Awaited<ReturnType<typeof api.listArchivedSessions>>
type ArchivedSessionBranches = Awaited<ReturnType<typeof api.listArchivedSessionBranches>>

export function archivedSessionsQueryOptions(): OpenWaggleQueryOptions<
  ArchivedSessions,
  Error,
  ArchivedSessions,
  typeof queryKeys.archivedSessions
> {
  return queryOptions({
    queryKey: queryKeys.archivedSessions,
    queryFn: () => api.listArchivedSessions(),
  })
}

export function archivedSessionBranchesQueryOptions(): OpenWaggleQueryOptions<
  ArchivedSessionBranches,
  Error,
  ArchivedSessionBranches,
  typeof queryKeys.archivedSessionBranches
> {
  return queryOptions({
    queryKey: queryKeys.archivedSessionBranches,
    queryFn: () => api.listArchivedSessionBranches(),
  })
}

interface RestoreSessionBranchInput {
  readonly sessionId: SessionId
  readonly branchId: SessionBranchId
}

export function useUnarchiveSessionMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (sessionId: SessionId) => api.unarchiveSession(sessionId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: queryKeys.archivedSessions,
        exact: true,
      })
    },
  })
}

export function useRestoreSessionBranchMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ sessionId, branchId }: RestoreSessionBranchInput) =>
      api.restoreSessionBranch(sessionId, branchId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: queryKeys.archivedSessionBranches,
        exact: true,
      })
    },
  })
}

export function useArchivedDeleteSessionMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (sessionId: SessionId) => api.deleteSession(sessionId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: queryKeys.archivedSessions,
        exact: true,
      })
    },
  })
}

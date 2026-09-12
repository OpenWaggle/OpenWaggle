import type { SessionBranchId, SessionId } from '@shared/types/brand'
import { type QueryClient, queryOptions, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/shared/lib/ipc'
import { deleteWorkspaceOwner } from '@/shell/workspace-panel-cleanup'
import { refreshAfterCommittedSessionMutation } from './committed-session-refresh'
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

export function refreshArchivedSessions(queryClient: QueryClient) {
  return Promise.all([
    queryClient.invalidateQueries({
      queryKey: queryKeys.archivedSessions,
      exact: true,
    }),
    queryClient.invalidateQueries({ queryKey: queryKeys.sessionHives }),
  ])
}

interface RestoreSessionBranchInput {
  readonly sessionId: SessionId
  readonly branchId: SessionBranchId
}

export function useUnarchiveSessionMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (sessionId: SessionId) => api.unarchiveSession(sessionId),
    onSuccess: () => refreshArchivedSessions(queryClient),
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
    mutationFn: async (sessionId: SessionId) => {
      await api.deleteSession(sessionId)
      await refreshAfterCommittedSessionMutation(
        () => deleteWorkspaceOwner(String(sessionId)),
        () => refreshArchivedSessions(queryClient),
      )
    },
  })
}

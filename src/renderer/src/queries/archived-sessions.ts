import type { SessionBranchId, SessionId } from '@shared/types/brand'
import type { SessionCatalogPage } from '@shared/types/session'
import {
  type InfiniteData,
  infiniteQueryOptions,
  type UseInfiniteQueryOptions,
  useMutation,
  useQueryClient,
} from '@tanstack/react-query'
import { api } from '@/shared/lib/ipc'
import { queryKeys } from './query-keys'

const ARCHIVED_PAGE_SIZE = 100
const INITIAL_CURSOR: string | null = null

interface RestoreSessionBranchInput {
  readonly sessionId: SessionId
  readonly branchId: SessionBranchId
}

export function archivedSessionBranchesQueryOptions(): UseInfiniteQueryOptions<
  SessionCatalogPage,
  Error,
  InfiniteData<SessionCatalogPage>,
  typeof queryKeys.archivedSessionBranches,
  string | null
> {
  return infiniteQueryOptions({
    queryKey: queryKeys.archivedSessionBranches,
    queryFn: ({ pageParam }) =>
      api.listArchivedSessionBranches(ARCHIVED_PAGE_SIZE, pageParam ?? undefined),
    initialPageParam: INITIAL_CURSOR,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? null,
  })
}

export function useUnarchiveSessionMutation() {
  return useMutation({
    mutationFn: (sessionId: SessionId) => api.unarchiveSession(sessionId),
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
  return useMutation({
    mutationFn: (sessionId: SessionId) => api.deleteSession(sessionId),
  })
}

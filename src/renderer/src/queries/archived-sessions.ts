import type {
  ArchivedItemsChange,
  ArchivedItemsFilter,
  ArchivedItemsPage,
  ArchivedItemsSort,
} from '@shared/types/archived-items'
import type { SessionBranchId, SessionId } from '@shared/types/brand'
import {
  type InfiniteData,
  infiniteQueryOptions,
  keepPreviousData,
  type QueryClient,
  type UseInfiniteQueryOptions,
  useMutation,
  useQueryClient,
} from '@tanstack/react-query'
import { api } from '@/shared/lib/ipc'
import { deleteWorkspaceOwner } from '@/shell/workspace-panel-cleanup'
import { refreshAfterCommittedSessionMutation } from './committed-session-refresh'
import { queryKeys } from './query-keys'

const ARCHIVED_ITEMS_PAGE_SIZE = 50
const INITIAL_CURSOR: string | null = null

export function refreshArchivedSessions(queryClient: QueryClient) {
  return Promise.all([
    queryClient.invalidateQueries({
      queryKey: queryKeys.archivedSessions,
      exact: true,
    }),
    queryClient.invalidateQueries({
      queryKey: queryKeys.archivedSessionBranches,
      exact: true,
    }),
    queryClient.invalidateQueries({ queryKey: queryKeys.archivedItems }),
    queryClient.invalidateQueries({ queryKey: queryKeys.sessionHives }),
  ])
}

interface RestoreSessionBranchInput {
  readonly sessionId: SessionId
  readonly branchId: SessionBranchId
}

/**
 * One Settings > Archived items list. Typing keeps the previous results on screen until the next
 * page arrives, so the list narrows instead of flashing empty.
 */
type ArchivedItemsQueryKey = [
  (typeof queryKeys.archivedItems)[0],
  ArchivedItemsFilter,
  ArchivedItemsSort,
]

export function archivedItemsQueryOptions(
  filter: ArchivedItemsFilter,
  sort: ArchivedItemsSort,
): UseInfiniteQueryOptions<
  ArchivedItemsPage,
  Error,
  InfiniteData<ArchivedItemsPage>,
  ArchivedItemsQueryKey,
  string | null
> {
  return infiniteQueryOptions({
    queryKey: [...queryKeys.archivedItems, filter, sort],
    queryFn: ({ pageParam }) =>
      api.queryArchivedItems({
        ...filter,
        sort,
        limit: ARCHIVED_ITEMS_PAGE_SIZE,
        ...(pageParam === null ? {} : { cursor: pageParam }),
      }),
    initialPageParam: INITIAL_CURSOR,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? null,
    placeholderData: keepPreviousData,
  })
}

/** Restores many Archived items at once, or archives them again to undo a restore. */
export function useSetArchivedItemsMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (change: ArchivedItemsChange) => api.setArchivedItems(change),
    // Some items may have changed even when the call fails part-way.
    onSettled: () => refreshArchivedSessions(queryClient),
  })
}

export function useUnarchiveSessionMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (sessionId: SessionId) => api.unarchiveSession(sessionId),
    // A restored Worker leaves the Hive "Archived" group; its branches may reappear too.
    onSuccess: () => refreshArchivedSessions(queryClient),
  })
}

export function useRestoreSessionBranchMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ sessionId, branchId }: RestoreSessionBranchInput) =>
      api.restoreSessionBranch(sessionId, branchId),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: queryKeys.archivedSessionBranches,
          exact: true,
        }),
        queryClient.invalidateQueries({ queryKey: queryKeys.archivedItems }),
      ])
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

export interface ArchivedSessionsDeletion {
  readonly deleted: readonly SessionId[]
  readonly failed: readonly { readonly sessionId: SessionId; readonly error: unknown }[]
}

/**
 * Permanently deletes many archived sessions, one after another, then refreshes once. A session
 * whose metadata the Host deleted still counts as deleted when its local cleanup fails after.
 */
export function useArchivedDeleteSessionsMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (sessionIds: readonly SessionId[]): Promise<ArchivedSessionsDeletion> => {
      const deleted: SessionId[] = []
      const failed: { sessionId: SessionId; error: unknown }[] = []
      for (const sessionId of sessionIds) {
        try {
          await api.deleteSession(sessionId)
        } catch (error) {
          failed.push({ sessionId, error })
          continue
        }
        deleted.push(sessionId)
        await deleteWorkspaceOwner(String(sessionId)).catch((error: unknown) => {
          failed.push({ sessionId, error })
        })
      }
      return { deleted, failed }
    },
    onSettled: () => refreshArchivedSessions(queryClient),
  })
}

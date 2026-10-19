import type {
  ArchivedItemsChange,
  ArchivedItemsFilter,
  ArchivedItemsPage,
  ArchivedItemsSort,
} from '@shared/types/archived-items'
import type { SessionId } from '@shared/types/brand'
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
import { queryKeys } from './query-keys'

const ARCHIVED_ITEMS_PAGE_SIZE = 50
const INITIAL_CURSOR: string | null = null

export function refreshArchivedSessions(queryClient: QueryClient) {
  return Promise.all([
    queryClient.invalidateQueries({
      queryKey: queryKeys.archivedSessions,
      exact: true,
    }),
    queryClient.invalidateQueries({ queryKey: queryKeys.archivedItems }),
    queryClient.invalidateQueries({ queryKey: queryKeys.sessionHives }),
  ])
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

export interface ArchivedSessionsDeletion {
  readonly deleted: readonly SessionId[]
  /** No longer archived when its turn came, so kept. */
  readonly skipped: readonly SessionId[]
  /** Already deleted elsewhere. */
  readonly missing: readonly SessionId[]
  readonly failed: readonly { readonly sessionId: SessionId; readonly message: string }[]
  /** Deleted, but this window could not clean up its local layout. */
  readonly cleanupFailed: readonly { readonly sessionId: SessionId; readonly message: string }[]
}

/** Storage failures arrive as DOMExceptions, which are not always `instanceof Error`. */
function describe(error: unknown) {
  const message =
    typeof error === 'object' && error !== null && 'message' in error ? error.message : null
  return typeof message === 'string' && message.trim() ? message : 'Cleanup failed.'
}

/**
 * Permanently deletes the selected sessions that are still archived. The Host skips any that left
 * the archive since they were selected, so a stale selection can never delete an active session.
 * A deleted session's local workspace layout is cleaned up after; a cleanup failure is reported
 * but the session still counts as deleted.
 */
export function useArchivedDeleteSessionsMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (sessionIds: readonly SessionId[]): Promise<ArchivedSessionsDeletion> => {
      const result = await api.deleteArchivedSessions([...sessionIds])
      const cleanups = await Promise.all(
        result.deleted.map((sessionId) =>
          deleteWorkspaceOwner(String(sessionId)).then(
            () => null,
            (error: unknown) => ({ sessionId, message: describe(error) }),
          ),
        ),
      )
      return {
        ...result,
        cleanupFailed: cleanups.filter((cleanup) => cleanup !== null),
      }
    },
    onSettled: () => refreshArchivedSessions(queryClient),
  })
}

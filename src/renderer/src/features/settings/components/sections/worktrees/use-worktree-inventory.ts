import { RepositoryPath } from '@shared/types/brand'
import type {
  WorktreeInventory,
  WorktreeInventoryEntry,
  WorktreeReclaimableSpace,
} from '@shared/types/worktree-inventory'
import { queryOptions, useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/shared/lib/ipc'

/** The Host caches a measurement for an hour; asking again sooner only returns that. */
const SPACE_STALE_MS = 3_600_000

const WORKTREE_INVENTORY_QUERY_KEY = ['worktree-inventory'] as const
const AUTOMATIC_WORKTREE_REMOVAL_LOG_QUERY_KEY = ['automatic-worktree-removal-log'] as const
const WORKTREE_SPACE_QUERY_KEY = 'worktree-space'

function worktreeInventoryQueryOptions() {
  return queryOptions({
    queryKey: WORKTREE_INVENTORY_QUERY_KEY,
    queryFn: () => api.getWorktreeInventory(),
  })
}

function automaticWorktreeRemovalLogQueryOptions() {
  return queryOptions({
    queryKey: AUTOMATIC_WORKTREE_REMOVAL_LOG_QUERY_KEY,
    queryFn: () => api.getAutomaticWorktreeRemovalLog(),
  })
}

export function useAutomaticWorktreeRemovalLog() {
  return useQuery(automaticWorktreeRemovalLogQueryOptions())
}

/*
 * Measuring walks a whole folder tree, so the page asks for one worktree at a time, in the order
 * it lists them, and each row fills in as its answer arrives.
 */
let measurementQueue: Promise<unknown> = Promise.resolve()

function measureInTurn(projectPath: string, path: string): Promise<WorktreeReclaimableSpace> {
  const task = () => api.measureWorktree(RepositoryPath(projectPath), path)
  const turn = measurementQueue.then(task, task)
  measurementQueue = turn.catch(() => undefined)
  return turn
}

/** The worktree a measurement is for. */
export type MeasuredWorktree = Pick<WorktreeInventoryEntry, 'path' | 'projectPath'>

function spaceQueryOptions(entry: MeasuredWorktree) {
  return queryOptions({
    queryKey: [WORKTREE_SPACE_QUERY_KEY, entry.path, entry.projectPath],
    queryFn: () => measureInTurn(entry.projectPath, entry.path),
    staleTime: SPACE_STALE_MS,
    retry: false,
  })
}

/** Reclaimable space by worktree path: a number, `undefined` while measuring, null on failure. */
export type WorktreeSpaceByPath = ReadonlyMap<string, number | null | undefined>

export function useWorktreeSpace(entries: readonly WorktreeInventoryEntry[]): WorktreeSpaceByPath {
  return useQueries({
    queries: entries.map(spaceQueryOptions),
    combine: (results) =>
      new Map(
        results.map((result, index) => [
          entries[index]?.path ?? '',
          result.isError ? null : result.data?.reclaimableBytes,
        ]),
      ),
  })
}

export function useWorktreeInventory() {
  return useQuery(worktreeInventoryQueryOptions())
}

/** Reads the list and the removal record again after something changed them. */
export function useRefreshWorktreeInventory() {
  const queryClient = useQueryClient()
  return async (
    removed: readonly MeasuredWorktree[] = [],
  ): Promise<WorktreeInventory | undefined> => {
    for (const worktree of removed) queryClient.removeQueries(spaceQueryOptions(worktree))
    await queryClient.invalidateQueries(automaticWorktreeRemovalLogQueryOptions())
    await queryClient.invalidateQueries(worktreeInventoryQueryOptions())
    return queryClient.getQueryData(worktreeInventoryQueryOptions().queryKey)
  }
}

import type { SessionId } from '@shared/types/brand'
import {
  type InfiniteData,
  infiniteQueryOptions,
  type UseInfiniteQueryOptions,
} from '@tanstack/react-query'
import { api } from '@/shared/lib/ipc'
import { queryKeys } from './query-keys'
import type { HiveSession } from './session-hive-contract'

/**
 * One keyset page of a Hive under its Queen, at any depth (ADR 0050).
 *
 * The tree query nests under the `sessionHives` key root, so the shared Hive event
 * subscription (`useSessionHiveInvalidation`) keeps it fresh with no second listener.
 */
export interface HiveTreePage {
  readonly root: HiveSession | null
  readonly members: readonly HiveSession[]
  /** Members across every page whose Delegation needs the user; each page reports the total. */
  readonly attentionCount: number
  readonly nextCursor?: string
}

const HIVE_TREE_PAGE_SIZE = 50

export async function readSessionHiveTreePage(
  sessionId: SessionId,
  cursor?: string,
): Promise<HiveTreePage> {
  const page = await api.listHiveTreeSessionCatalogPage(sessionId, HIVE_TREE_PAGE_SIZE, cursor)
  // A Host that answers with members but no root cannot render a Hive; refuse the page rather
  // than silently showing a Queenless list.
  if (page.root === null && page.members.length > 0) {
    throw new Error('Hive tree page is missing its Queen.')
  }
  return page
}

export function sessionHiveTreeQueryOptions(
  sessionId: SessionId,
): UseInfiniteQueryOptions<
  HiveTreePage,
  Error,
  InfiniteData<HiveTreePage>,
  ReturnType<typeof queryKeys.sessionHiveTree>,
  string | undefined
> {
  return infiniteQueryOptions<
    HiveTreePage,
    Error,
    InfiniteData<HiveTreePage>,
    ReturnType<typeof queryKeys.sessionHiveTree>,
    string | undefined
  >({
    queryKey: queryKeys.sessionHiveTree(sessionId),
    queryFn: ({ pageParam }) => readSessionHiveTreePage(sessionId, pageParam),
    initialPageParam: undefined,
    getNextPageParam: (page) => page.nextCursor,
  })
}

/** All members read so far, Queen excluded. */
export function hiveTreeMembers(
  pages: readonly HiveTreePage[] | undefined,
): readonly HiveSession[] {
  return pages?.flatMap((page) => page.members) ?? []
}

/** Whether any live member, on any page, needs the user; read from the newest page's total. */
export function hiveTreeNeedsAttention(pages: readonly HiveTreePage[] | undefined): boolean {
  return (pages?.at(-1)?.attentionCount ?? 0) > 0
}

export function hiveTreeRoot(pages: readonly HiveTreePage[] | undefined): HiveSession | null {
  return pages?.[0]?.root ?? null
}

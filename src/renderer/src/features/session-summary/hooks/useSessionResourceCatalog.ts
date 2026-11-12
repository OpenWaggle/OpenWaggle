import { SessionId } from '@shared/types/brand'
import type {
  SessionResource,
  SessionResourceCatalogPage,
  SessionResourceCatalogView,
  SessionResourceRouteSelection,
} from '@shared/types/session-resource'
import { SESSION_RESOURCE_CATALOG_STALE_MESSAGE } from '@shared/types/session-resource'
import {
  type InfiniteData,
  infiniteQueryOptions,
  type QueryClient,
  queryOptions,
  type UseInfiniteQueryResult,
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import { useCallback, useEffect } from 'react'
import { api } from '@/shared/lib/ipc'

const SESSION_RESOURCE_CATALOG_PAGE_SIZE = 40
const SESSION_RESOURCE_ROUTE_NODE_LIMIT = 512
const INITIAL_CATALOG_CURSOR: string | null = null
const NO_NODE_IDS: readonly string[] = []

export type SessionResourceCatalogQueryKey = readonly [
  'session-resource-catalog',
  string,
  SessionResourceCatalogView,
  string,
  SessionResourceRouteSelection | null,
  number,
]

interface SessionResourceCatalogOptions {
  readonly activeBranchId?: string | null
  readonly enabled?: boolean
  readonly pageSize?: number
  readonly pathNodeIds?: readonly string[]
}

export type SessionResourceCatalogQueryResult = Pick<
  UseInfiniteQueryResult<InfiniteData<SessionResourceCatalogPage>>,
  | 'data'
  | 'error'
  | 'hasNextPage'
  | 'isError'
  | 'isFetchingNextPage'
  | 'isLoading'
  | 'isSuccess'
  | 'refetch'
> & {
  readonly resources: readonly SessionResource[]
  readonly total: number
  readonly loadNextPage: () => Promise<void>
}

export const sessionResourceCatalogQueryKey = (
  sessionId: string,
  view: SessionResourceCatalogView,
  activeBranchId: string | null,
  pageSize = SESSION_RESOURCE_CATALOG_PAGE_SIZE,
  selection: SessionResourceRouteSelection | null = routeSelection(activeBranchId, NO_NODE_IDS),
) => {
  const key: SessionResourceCatalogQueryKey = [
    'session-resource-catalog',
    sessionId,
    view,
    activeBranchId ?? 'none',
    selection,
    pageSize,
  ] as const
  return key
}

function routeSelection(activeBranchId: string | null, pathNodeIds: readonly string[]) {
  if (!activeBranchId && pathNodeIds.length === 0) return null
  const boundedNodeIds = [...new Set(pathNodeIds)].slice(-SESSION_RESOURCE_ROUTE_NODE_LIMIT)
  return { branchId: activeBranchId, pathNodeIds: boundedNodeIds }
}

function isStaleCatalogError(error: unknown) {
  return error instanceof Error && error.message.includes(SESSION_RESOURCE_CATALOG_STALE_MESSAGE)
}

function catalogInfiniteOptions(
  sessionId: string | null,
  view: SessionResourceCatalogView,
  activeBranchId: string | null,
  pathNodeIds: readonly string[],
  pageSize: number,
  enabled: boolean,
) {
  const selection = routeSelection(activeBranchId, pathNodeIds)
  return infiniteQueryOptions({
    queryKey: sessionResourceCatalogQueryKey(
      sessionId ?? 'none',
      view,
      activeBranchId,
      pageSize,
      selection,
    ),
    initialPageParam: INITIAL_CATALOG_CURSOR,
    queryFn: ({ pageParam }) => {
      if (!sessionId) {
        return Promise.resolve<SessionResourceCatalogPage>({
          resources: [],
          total: 0,
          nextCursor: null,
          orderRevision: 'none',
        })
      }
      return api.listSessionResourcePage(
        SessionId(sessionId),
        selection
          ? { view, cursor: pageParam, limit: pageSize, selection }
          : { view, cursor: pageParam, limit: pageSize },
      )
    },
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    enabled,
  })
}

function resetCatalogPage(
  queryClient: QueryClient,
  sessionId: string | null,
  view: SessionResourceCatalogView,
  activeBranchId: string | null,
  pathNodeIds: readonly string[],
  pageSize: number,
) {
  const selection = routeSelection(activeBranchId, pathNodeIds)
  return queryClient.resetQueries({
    queryKey: sessionResourceCatalogQueryKey(
      sessionId ?? 'none',
      view,
      activeBranchId,
      pageSize,
      selection,
    ),
    exact: true,
  })
}

export function useSessionResourceCatalog(
  sessionId: string | null,
  view: SessionResourceCatalogView,
  options: SessionResourceCatalogOptions = {},
) {
  const activeBranchId = options.activeBranchId ?? null
  const pathNodeIds = options.pathNodeIds ?? NO_NODE_IDS
  const pageSize = options.pageSize ?? SESSION_RESOURCE_CATALOG_PAGE_SIZE
  const enabled = sessionId !== null && options.enabled !== false
  const queryClient = useQueryClient()
  const query = useInfiniteQuery(
    catalogInfiniteOptions(sessionId, view, activeBranchId, pathNodeIds, pageSize, enabled),
  )
  const pages = query.data?.pages ?? []
  const firstRevision = pages[0]?.orderRevision
  const mixedRevision = pages.some((page) => page.orderRevision !== firstRevision)
  const consistentPages = mixedRevision
    ? pages.filter((page) => page.orderRevision === firstRevision)
    : pages
  const resetCatalog = useCallback(
    () => resetCatalogPage(queryClient, sessionId, view, activeBranchId, pathNodeIds, pageSize),
    [activeBranchId, pageSize, pathNodeIds, queryClient, sessionId, view],
  )
  const fetchNextPage = query.fetchNextPage
  const loadNextPage = useCallback(async () => {
    try {
      const result = await fetchNextPage()
      if (result.isError && isStaleCatalogError(result.error)) await resetCatalog()
    } catch (cause) {
      if (isStaleCatalogError(cause)) await resetCatalog()
      else throw cause
    }
  }, [fetchNextPage, resetCatalog])
  useEffect(() => {
    if (mixedRevision) void resetCatalog()
  }, [mixedRevision, resetCatalog])
  return {
    data: query.data,
    error: query.error,
    hasNextPage: query.hasNextPage,
    isError: query.isError,
    isFetchingNextPage: query.isFetchingNextPage,
    isLoading: query.isLoading,
    isSuccess: query.isSuccess,
    refetch: query.refetch,
    resources: consistentPages.flatMap((page) => page.resources),
    total: consistentPages[0]?.total ?? 0,
    loadNextPage,
  } satisfies SessionResourceCatalogQueryResult
}

export function useSessionResource(
  sessionId: string | null,
  resourceId: string | null,
  view: SessionResourceCatalogView,
  activeBranchId: string | null = null,
  pathNodeIds: readonly string[] = NO_NODE_IDS,
) {
  const selection = routeSelection(activeBranchId, pathNodeIds)
  return useQuery(
    queryOptions({
      queryKey: [
        'session-resource-exact',
        sessionId ?? 'none',
        resourceId ?? 'none',
        view,
        activeBranchId ?? 'none',
        selection,
      ] as const,
      queryFn: async () => {
        if (!sessionId || !resourceId) return null
        return selection
          ? api.getSessionResource(SessionId(sessionId), resourceId, view, selection)
          : api.getSessionResource(SessionId(sessionId), resourceId, view)
      },
      enabled: sessionId !== null && resourceId !== null,
    }),
  )
}

export function useSessionImageLocation(
  sessionId: string | null,
  resourceId: string | null,
  activeBranchId: string | null = null,
  pathNodeIds: readonly string[] = NO_NODE_IDS,
) {
  const selection = routeSelection(activeBranchId, pathNodeIds)
  return useQuery(
    queryOptions({
      queryKey: [
        'session-resource-image-location',
        sessionId ?? 'none',
        resourceId ?? 'none',
        activeBranchId ?? 'none',
        selection,
      ] as const,
      queryFn: async () => {
        if (!sessionId || !resourceId) return null
        return selection
          ? api.locateSessionResourceImage(SessionId(sessionId), resourceId, selection)
          : api.locateSessionResourceImage(SessionId(sessionId), resourceId)
      },
      enabled: sessionId !== null && resourceId !== null,
    }),
  )
}

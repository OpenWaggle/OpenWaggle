import { SessionId } from '@shared/types/brand'
import type {
  SessionResource,
  SessionResourceCatalogPage,
  SessionResourceCatalogView,
  SessionResourceImageLocation,
  SessionResourceList,
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
  UseInfiniteQueryResult<InfiniteData<SessionResourceCatalogPage>, Error>,
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
): SessionResourceCatalogQueryKey =>
  [
    'session-resource-catalog',
    sessionId,
    view,
    activeBranchId ?? 'none',
    selection,
    pageSize,
  ] as const

function routeSelection(
  activeBranchId: string | null,
  pathNodeIds: readonly string[],
): SessionResourceRouteSelection | null {
  if (!activeBranchId && pathNodeIds.length === 0) return null
  const boundedNodeIds = [...new Set(pathNodeIds)].slice(-SESSION_RESOURCE_ROUTE_NODE_LIMIT)
  return { branchId: activeBranchId, pathNodeIds: boundedNodeIds }
}

function matchesCatalogView(resource: SessionResource, view: SessionResourceCatalogView) {
  if (view === 'sources') return resource.isSource
  if (view === 'outputs') return resource.isOutput
  if (view === 'change-requests') return resource.kind === 'change-request' && resource.isOutput
  if (view === 'images') {
    if (resource.kind !== 'image' || resource.locator?.startsWith('http://')) return false
    return resource.available || resource.locator?.startsWith('https://') === true
  }
  return true
}

function normalizeSessionResourceList(
  result: SessionResourceList | SessionResource[],
): SessionResourceList {
  return 'resources' in result ? result : { resources: result, backfillComplete: true }
}

export async function loadLegacyCatalogPage(
  sessionId: string,
  view: SessionResourceCatalogView,
  cursor: string | null = null,
  limit = Number.POSITIVE_INFINITY,
): Promise<SessionResourceCatalogPage> {
  const result: SessionResourceList | SessionResource[] = await api.listSessionResources(
    SessionId(sessionId),
  )
  const matching = normalizeSessionResourceList(result).resources.filter((resource) =>
    matchesCatalogView(resource, view),
  )
  const offset = cursor?.startsWith('legacy:') ? Number(cursor.slice('legacy:'.length)) : 0
  const pageResources = matching.slice(offset, offset + limit)
  const nextOffset = offset + pageResources.length
  return {
    resources: pageResources,
    total: matching.length,
    nextCursor: nextOffset < matching.length ? `legacy:${String(nextOffset)}` : null,
    orderRevision: 'legacy',
  }
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
        return Promise.resolve({
          resources: [],
          total: 0,
          nextCursor: null,
          orderRevision: 'none',
        } satisfies SessionResourceCatalogPage)
      }
      return typeof api.listSessionResourcePage === 'function'
        ? api.listSessionResourcePage(
            SessionId(sessionId),
            selection
              ? { view, cursor: pageParam, limit: pageSize, selection }
              : { view, cursor: pageParam, limit: pageSize },
          )
        : loadLegacyCatalogPage(sessionId, view, pageParam, pageSize)
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
): SessionResourceCatalogQueryResult {
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
  }
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
        if (typeof api.getSessionResource === 'function') {
          return selection
            ? api.getSessionResource(SessionId(sessionId), resourceId, view, selection)
            : api.getSessionResource(SessionId(sessionId), resourceId, view)
        }
        const page = await loadLegacyCatalogPage(sessionId, view)
        return page.resources.find((resource) => resource.id === resourceId) ?? null
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
      queryFn: async (): Promise<SessionResourceImageLocation | null> => {
        if (!sessionId || !resourceId) return null
        if (typeof api.locateSessionResourceImage === 'function') {
          return selection
            ? api.locateSessionResourceImage(SessionId(sessionId), resourceId, selection)
            : api.locateSessionResourceImage(SessionId(sessionId), resourceId)
        }
        const page = await loadLegacyCatalogPage(sessionId, 'images')
        const index = page.resources.findIndex((resource) => resource.id === resourceId)
        const resource = page.resources[index]
        if (!resource || index < 0) return null
        return {
          resource,
          previous: page.resources[index - 1] ?? null,
          next: page.resources[index + 1] ?? null,
          index,
          total: page.total,
          orderRevision: page.orderRevision,
        }
      },
      enabled: sessionId !== null && resourceId !== null,
    }),
  )
}

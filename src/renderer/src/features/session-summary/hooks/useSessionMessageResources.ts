import { SessionId } from '@shared/types/brand'
import type { SessionResource } from '@shared/types/session-resource'
import { SESSION_RESOURCE_CATALOG_STALE_MESSAGE } from '@shared/types/session-resource'
import { queryOptions, type UseQueryResult, useQueries } from '@tanstack/react-query'
import { useState } from 'react'
import { api } from '@/shared/lib/ipc'

const SESSION_RESOURCE_NODE_CHUNK_SIZE = 64
const SESSION_RESOURCE_NODE_PAGE_SIZE = 128
const SESSION_RESOURCE_NODE_QUERY_CONCURRENCY = 4
const SESSION_RESOURCE_NODE_STALE_ATTEMPTS = 2

let activeNodeResourceQueries = 0
interface PendingNodeResourceQuery {
  readonly resolve: (acquired: boolean) => void
  readonly signal: AbortSignal
  readonly stopWaiting: () => void
}
const pendingNodeResourceQueries: PendingNodeResourceQuery[] = []

async function acquireNodeResourceQueryPermit(signal: AbortSignal) {
  if (signal.aborted) return false
  if (activeNodeResourceQueries < SESSION_RESOURCE_NODE_QUERY_CONCURRENCY) {
    activeNodeResourceQueries += 1
    return true
  }
  return new Promise<boolean>((resolve) => {
    const stopWaiting = () => {
      const index = pendingNodeResourceQueries.indexOf(waiter)
      if (index !== -1) pendingNodeResourceQueries.splice(index, 1)
      resolve(false)
    }
    const waiter: PendingNodeResourceQuery = { resolve, signal, stopWaiting }
    pendingNodeResourceQueries.push(waiter)
    signal.addEventListener('abort', stopWaiting, { once: true })
  })
}

function releaseNodeResourceQueryPermit() {
  let next = pendingNodeResourceQueries.shift()
  while (next?.signal.aborted) {
    next.signal.removeEventListener('abort', next.stopWaiting)
    next.resolve(false)
    next = pendingNodeResourceQueries.shift()
  }
  if (next) {
    // Transfer the occupied slot directly so a newly scheduled query cannot jump the queue.
    next.signal.removeEventListener('abort', next.stopWaiting)
    next.resolve(true)
    return
  }
  activeNodeResourceQueries -= 1
}

function isStaleCatalogError(error: unknown) {
  return error instanceof Error && error.message.includes(SESSION_RESOURCE_CATALOG_STALE_MESSAGE)
}

function mergeNodeResources(resources: readonly SessionResource[]) {
  const byId = new Map<string, SessionResource>()
  for (const resource of resources) {
    const existing = byId.get(resource.id)
    if (!existing) {
      byId.set(resource.id, resource)
      continue
    }
    const occurrenceIds = new Set(existing.occurrences.map(({ id }) => id))
    const occurrences = [
      ...existing.occurrences,
      ...resource.occurrences.filter(({ id }) => !occurrenceIds.has(id)),
    ]
    byId.set(resource.id, { ...resource, occurrences })
  }
  return [...byId.values()].sort(
    (left, right) => left.createdAt - right.createdAt || left.id.localeCompare(right.id),
  )
}

async function loadNodeResourceChunk(
  sessionId: string,
  nodeIds: readonly string[],
  signal: AbortSignal,
) {
  if (signal.aborted) return []
  for (let attempt = 0; attempt < SESSION_RESOURCE_NODE_STALE_ATTEMPTS; attempt += 1) {
    const resources: SessionResource[] = []
    let cursor: string | null = null
    let revision: string | null = null
    try {
      do {
        if (signal.aborted) return []
        const page = await api.listSessionResourceNodePage(SessionId(sessionId), {
          nodeIds,
          kind: 'image',
          cursor,
          limit: SESSION_RESOURCE_NODE_PAGE_SIZE,
        })
        if (signal.aborted) return []
        if (revision !== null && page.orderRevision !== revision) {
          throw new Error(SESSION_RESOURCE_CATALOG_STALE_MESSAGE)
        }
        revision = page.orderRevision
        resources.push(...page.resources)
        cursor = page.nextCursor
      } while (cursor !== null)
      return resources
    } catch (cause) {
      if (attempt + 1 >= SESSION_RESOURCE_NODE_STALE_ATTEMPTS || !isStaleCatalogError(cause)) {
        throw cause
      }
    }
  }
  return []
}

async function withNodeResourceQueryPermit(
  signal: AbortSignal,
  task: () => Promise<readonly SessionResource[]>,
) {
  const acquired = await acquireNodeResourceQueryPermit(signal)
  if (!acquired) return []
  try {
    if (signal.aborted) return []
    // TanStack cancels the observer immediately, but IPC keeps running in main. The
    // permit belongs to that work, not the observer, and is held until it settles.
    const resources = await task()
    return signal.aborted ? [] : resources
  } finally {
    releaseNodeResourceQueryPermit()
  }
}

function sessionMessageResourceChunkQueryOptions(
  sessionId: string | null,
  nodeIds: readonly string[],
) {
  return queryOptions({
    // The exact node list makes cache identity collision-free. Completed 64-node chunks stay
    // stable as the transcript grows; only the bounded tail chunk is replaced and reloaded.
    queryKey: ['session-resource-nodes', sessionId ?? 'none', nodeIds] as const,
    queryFn: async ({ signal }) => {
      if (!sessionId || nodeIds.length === 0) return []
      return withNodeResourceQueryPermit(signal, () =>
        loadNodeResourceChunk(sessionId, nodeIds, signal),
      )
    },
    enabled: sessionId !== null && nodeIds.length > 0,
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: 0,
  })
}

function chunkNodeIds(nodeIds: readonly string[]) {
  const chunks: string[][] = []
  for (let offset = 0; offset < nodeIds.length; offset += SESSION_RESOURCE_NODE_CHUNK_SIZE) {
    chunks.push(nodeIds.slice(offset, offset + SESSION_RESOURCE_NODE_CHUNK_SIZE))
  }
  return chunks
}

export interface SessionMessageResourceQueryResult {
  readonly data: SessionResource[]
  readonly error: Error | null
  readonly isError: boolean
  readonly isFetching: boolean
  readonly isPending: boolean
  readonly isSuccess: boolean
  readonly refetch: () => Promise<unknown>
}

function combineNodeResourceQueries(
  results: readonly UseQueryResult<readonly SessionResource[]>[],
) {
  const value: SessionMessageResourceQueryResult = {
    data: mergeNodeResources(results.flatMap((result) => result.data ?? [])),
    error: results.find((result) => result.error !== null)?.error ?? null,
    isError: results.some((result) => result.isError),
    isFetching: results.some((result) => result.isFetching),
    isPending: results.some((result) => result.isPending),
    isSuccess: results.every((result) => result.isSuccess),
    refetch: () => Promise.all(results.map((result) => result.refetch())),
  }
  return value
}

interface CompletedMessageResourceQuery {
  readonly sessionId: string | null
  readonly nodeIds: readonly string[]
  readonly data: readonly SessionResource[]
}

function isExpandedTranscriptWindow(
  previous: CompletedMessageResourceQuery | null,
  sessionId: string | null,
  nodeIds: readonly string[],
) {
  const nextNodeIds = new Set(nodeIds)
  return (
    previous?.sessionId === sessionId &&
    previous.nodeIds.length < nodeIds.length &&
    previous.nodeIds.every((nodeId) => nextNodeIds.has(nodeId))
  )
}

export function useSessionImageResourcesByNodeIds(
  sessionId: string | null,
  nodeIds: readonly string[],
) {
  const uniqueNodeIds = [...new Set(nodeIds)]
  const chunks = chunkNodeIds(uniqueNodeIds)
  const [previousCompleted, setPreviousCompleted] = useState<CompletedMessageResourceQuery | null>(
    null,
  )
  const query = useQueries({
    queries: chunks.map((chunk) => sessionMessageResourceChunkQueryOptions(sessionId, chunk)),
    combine: combineNodeResourceQueries,
  })
  const data = isExpandedTranscriptWindow(previousCompleted, sessionId, uniqueNodeIds)
    ? mergeNodeResources([...(previousCompleted?.data ?? []), ...query.data])
    : query.data
  // Remember the last complete answer, so a window that grows keeps its rows while it loads.
  if (query.isSuccess && previousCompleted?.data !== query.data) {
    setPreviousCompleted({ sessionId, nodeIds: uniqueNodeIds, data: query.data })
  }
  const result: SessionMessageResourceQueryResult = {
    data,
    error: query.error,
    isError: query.isError,
    isFetching: query.isFetching,
    isPending: query.isPending,
    isSuccess: query.isSuccess,
    refetch: query.refetch,
  }
  return result
}

import type { SessionId } from '@shared/types/brand'
import {
  type InfiniteData,
  infiniteQueryOptions,
  type UseInfiniteQueryOptions,
} from '@tanstack/react-query'
import { api } from '@/shared/lib/ipc'
import { queryKeys } from './query-keys'
import type { HiveRelationsPage, SessionHiveReader } from './session-hive-contract'

const HIVE_PAGE_SIZE = 50

export async function readSessionHivePage(
  reader: SessionHiveReader,
  sessionId: SessionId,
  cursor?: string,
): Promise<HiveRelationsPage> {
  if ('listHiveSessionCatalogPage' in reader && reader.listHiveSessionCatalogPage) {
    const page = await reader.listHiveSessionCatalogPage(sessionId, HIVE_PAGE_SIZE, cursor)
    const current = page.context.find((session) => session.id === sessionId) ?? null
    if (!current && (page.context.length > 0 || page.workers.length > 0)) {
      throw new Error('Hive catalog does not belong to the opened session.')
    }
    if (page.workers.some((worker) => worker.lineage?.parentSessionId !== sessionId)) {
      throw new Error('Hive catalog contains a worker from another session.')
    }
    const parent =
      page.context.find((session) => session.id === current?.lineage?.parentSessionId) ?? null
    return { current, parent, workers: page.workers, nextCursor: page.nextCursor }
  }
  // Transitional projection only. A Host error must never fall back to stale legacy data.
  if (reader.getSessionHiveRelations) return reader.getSessionHiveRelations(sessionId)
  throw new Error('Session Hive reads are unavailable in this app version.')
}

export function sessionHiveRelationsQueryOptions(
  sessionId: SessionId,
): UseInfiniteQueryOptions<
  HiveRelationsPage,
  Error,
  InfiniteData<HiveRelationsPage>,
  ReturnType<typeof queryKeys.sessionHive>,
  string | undefined
> {
  return infiniteQueryOptions<
    HiveRelationsPage,
    Error,
    InfiniteData<HiveRelationsPage>,
    ReturnType<typeof queryKeys.sessionHive>,
    string | undefined
  >({
    queryKey: queryKeys.sessionHive(sessionId),
    queryFn: ({ pageParam }) => readSessionHivePage(api, sessionId, pageParam),
    initialPageParam: undefined,
    getNextPageParam: (page) => page.nextCursor,
  })
}

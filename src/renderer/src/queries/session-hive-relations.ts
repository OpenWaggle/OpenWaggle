import type { SessionId } from '@shared/types/brand'
import { queryOptions } from '@tanstack/react-query'
import { api } from '@/shared/lib/ipc'
import { queryKeys } from './query-keys'
import type { OpenWaggleQueryOptions } from './query-options'

type SessionHiveRelations = Awaited<ReturnType<typeof api.getSessionHiveRelations>>

export function sessionHiveRelationsQueryOptions(
  sessionId: SessionId,
): OpenWaggleQueryOptions<
  SessionHiveRelations,
  Error,
  SessionHiveRelations,
  ReturnType<typeof queryKeys.sessionHive>
> {
  return queryOptions({
    queryKey: queryKeys.sessionHive(sessionId),
    queryFn: () => api.getSessionHiveRelations(sessionId),
  })
}

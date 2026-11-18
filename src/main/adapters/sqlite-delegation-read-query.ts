import type * as SqlClient from '@effect/sql/SqlClient'
import type { LocalSessionProfileAuthority } from '@shared/types/local-session-profile'
import { SESSION_QUERY_MAX_RESPONSE_BYTES } from '@shared/types/session-query'
import * as Effect from 'effect/Effect'
import { fitDelegationHistoryPage, selectDelegationHistoryPrefix } from './sqlite-delegation-page'
import type {
  DelegationHistoryRows,
  DelegationReadCursor,
  DelegationReadRequest,
} from './sqlite-delegation-query-model'
import { DEFAULT_DELEGATION_HISTORY_LIMIT } from './sqlite-delegation-query-model'
import {
  readDelegationHistoryDescriptors,
  readDelegationHistoryHighWater,
  readDelegationSummary,
} from './sqlite-delegation-read-descriptors'
import { readDelegationPrimaryHistory } from './sqlite-delegation-read-primary'
import { readDelegationScopeHistory } from './sqlite-delegation-read-scope'
import { readDelegationVerificationHistory } from './sqlite-delegation-read-verification'

export function readDelegationRows(
  sql: SqlClient.SqlClient,
  authority: LocalSessionProfileAuthority | undefined,
  request: DelegationReadRequest,
  cursor: DelegationReadCursor | null,
) {
  const delegationId = request.query.delegationId
  const limit = request.query.limit ?? DEFAULT_DELEGATION_HISTORY_LIMIT
  return Effect.gen(function* () {
    const delegation = yield* readDelegationSummary(sql, delegationId)
    if (!delegation) return { status: 'not-found' as const }
    const highWater = cursor?.through ?? (yield* readDelegationHistoryHighWater(sql))
    const descriptors = yield* readDelegationHistoryDescriptors(
      sql,
      authority,
      delegationId,
      cursor,
      highWater,
      limit,
    )
    const selected = selectDelegationHistoryPrefix(descriptors, limit)
    if ((selected[0]?.estimated_bytes ?? 0) > SESSION_QUERY_MAX_RESPONSE_BYTES) {
      return { status: 'record-too-large' as const }
    }
    const primary = yield* readDelegationPrimaryHistory(sql, delegationId, selected)
    const scope = yield* readDelegationScopeHistory(sql, delegationId, selected)
    const verification = yield* readDelegationVerificationHistory(sql, selected)
    const rows: DelegationHistoryRows = {
      delegation,
      ...primary,
      ...scope,
      ...verification,
    }
    return fitDelegationHistoryPage(request, rows, selected, descriptors.length, highWater)
  })
}

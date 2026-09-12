import type * as SqlClient from '@effect/sql/SqlClient'
import type { LocalSessionProfileAuthority } from '@shared/types/local-session-profile'
import type { SessionQueryRequest } from '@shared/types/session-query'
import * as Effect from 'effect/Effect'
import { listDelegations } from './sqlite-delegation-list-query'
import { readDelegationCursor } from './sqlite-delegation-query-cursor'
import { delegationReadResponse } from './sqlite-delegation-query-response'
import { readDelegationRows } from './sqlite-delegation-read-query'
import { invalidSessionQueryCursor, sessionQueryResponse } from './sqlite-session-query-support'

export { listDelegations }

export function readDelegation(
  sql: SqlClient.SqlClient,
  authority: LocalSessionProfileAuthority | undefined,
  request: SessionQueryRequest,
) {
  if (request.query.operation !== 'delegations-read') throw new Error('Expected Delegation read.')
  const readRequest = { ...request, query: request.query }
  const cursor = readDelegationCursor(readRequest)
  if (cursor === 'invalid') return Effect.succeed(invalidSessionQueryCursor(request))
  return Effect.gen(function* () {
    const result = yield* readDelegationRows(sql, authority, readRequest, cursor)
    if (result.status === 'not-found') {
      return sessionQueryResponse(request, {
        operation: 'delegations-read',
        error: { code: 'delegation_not_found', message: 'Delegation not found.' },
      })
    }
    if (result.status === 'record-too-large') {
      return sessionQueryResponse(request, {
        operation: 'delegations-read',
        error: {
          code: 'record_too_large',
          message: 'A Delegation history record exceeds the maximum response size.',
        },
      })
    }
    return sessionQueryResponse(request, delegationReadResponse(result.rows))
  })
}

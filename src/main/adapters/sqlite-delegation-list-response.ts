import type { SessionQueryRequest } from '@shared/types/session-query'
import type { DelegationSummaryRow } from './sqlite-delegation-query-rows'
import { delegationSummary } from './sqlite-delegation-query-summary'
import { encodeSessionQueryCursor, sessionQueryResponse } from './sqlite-session-query-support'

type DelegationsListRequest = SessionQueryRequest & {
  readonly query: Extract<SessionQueryRequest['query'], { readonly operation: 'delegations-list' }>
}

export function delegationListResponse(
  request: DelegationsListRequest,
  rows: readonly DelegationSummaryRow[],
) {
  const page = rows.slice(0, request.query.limit)
  const last = page.at(-1)
  return sessionQueryResponse(request, {
    operation: 'delegations-list',
    delegations: page.map(delegationSummary),
    ...(rows.length > request.query.limit && last
      ? {
          nextCursor: encodeSessionQueryCursor({
            updatedAt: last.updated_at,
            delegationId: last.delegation_id,
          }),
        }
      : {}),
  })
}

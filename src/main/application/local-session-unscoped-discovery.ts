import type { LocalSessionCommandPayload } from '@shared/types/local-session-protocol'

export function isUnscopedSessionDiscovery(payload: LocalSessionCommandPayload) {
  if (payload.contract !== 'session-query-v2') return false
  const query = payload.request.query
  return (
    (query.operation === 'list' ||
      query.operation === 'search' ||
      query.operation === 'delegations-list') &&
    query.projectPath === undefined
  )
}

import type { SemanticDiscoveryReadiness, SessionQuerySummary } from '@shared/types/session-query'
import { SESSION_DISCOVERY_WINDOW_LIMIT } from './session-discovery-window-store'
import {
  type DiscoverySearchRequest,
  type DiscoverySearchRow,
  discoveryWindowEntries,
  fuseDiscoveryEntries,
  semanticDiscoveryNotReady,
} from './sqlite-session-discovery-window'
import { decodeSessionQueryCursor } from './sqlite-session-query-support'

export function discoveryCursor(request: DiscoverySearchRequest) {
  const cursor = decodeSessionQueryCursor(request.query.cursor)
  if (cursor === 'invalid') return 'invalid' as const
  if (!cursor) return null
  return typeof cursor.windowId === 'string' && typeof cursor.offset === 'number'
    ? { windowId: cursor.windowId, offset: cursor.offset }
    : ('invalid' as const)
}

export function selectDiscoveryEntries(
  mode: DiscoverySearchRequest['query']['mode'],
  semanticUsable: boolean,
  lexicalRows: readonly DiscoverySearchRow[],
  semanticEntries: readonly { readonly session: SessionQuerySummary }[],
) {
  const lexicalEntries = discoveryWindowEntries(lexicalRows)
  if (mode === 'semantic') return semanticEntries.slice(0, SESSION_DISCOVERY_WINDOW_LIMIT)
  if (mode === 'hybrid' && semanticUsable) {
    return fuseDiscoveryEntries(lexicalEntries, semanticEntries)
  }
  return lexicalEntries
}

export function semanticFreshnessFailure(
  request: DiscoverySearchRequest,
  fresh: boolean,
  readiness: SemanticDiscoveryReadiness | undefined,
) {
  if (!request.query.requireFresh || !readiness || fresh) return null
  const message = request.query.waitTimeoutMs
    ? 'Semantic Session discovery did not become fresh before the bounded wait expired.'
    : 'Semantic Session discovery is not fresh. Provide a bounded wait timeout to wait for preparation.'
  return semanticDiscoveryNotReady(request, readiness, message)
}

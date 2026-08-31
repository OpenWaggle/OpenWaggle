import { canonicalJson } from '@shared/canonical-json'
import type { LocalSessionProfileAuthority } from '@shared/types/local-session-profile'
import type {
  SemanticDiscoveryReadiness,
  SessionQueryRequest,
  SessionQuerySummary,
} from '@shared/types/session-query'
import {
  SESSION_DISCOVERY_WINDOW_LIMIT,
  type SessionDiscoveryWindow,
} from './session-discovery-window-store'
import {
  encodeSessionQueryCursor,
  type SessionQuerySummaryRow,
  sessionQueryResponse,
  sessionQuerySummary,
} from './sqlite-session-query-support'

const RECIPROCAL_RANK_FUSION_K = 60

export interface DiscoverySearchRow extends SessionQuerySummaryRow {
  readonly score: number
  readonly matched_fields: string
  readonly snippet: string | null
  readonly exact_match: number
  readonly transcript_node_id: string | null
  readonly transcript_run_id: string | null
  readonly transcript_created_order: number | null
}

export type DiscoverySearchRequest = SessionQueryRequest & {
  readonly query: Extract<SessionQueryRequest['query'], { operation: 'search' }>
}

export function defaultSessionSearchMode(query: DiscoverySearchRequest['query']) {
  return query.mode ?? (query.searchScope === 'full-transcript' ? 'lexical' : 'hybrid')
}

export function discoveryWindowIdentity(
  request: DiscoverySearchRequest,
  authority: LocalSessionProfileAuthority | undefined,
  callerId: string | undefined,
) {
  const query = request.query
  return {
    callerKey: callerId ?? authority?.profileId ?? 'local-internal',
    authoritySignature: canonicalJson(authority ?? { localUser: true }),
    signature: canonicalJson({
      query: query.query.trim(),
      projectPath: query.projectPath ?? null,
      workingPath: query.workingPath ?? null,
      includeArchived: query.includeArchived ?? false,
      searchScope: query.searchScope ?? 'discovery',
      mode: defaultSessionSearchMode(query),
      requireFresh: query.requireFresh ?? false,
      waitTimeoutMs: query.waitTimeoutMs ?? 0,
    }),
  }
}

export function discoveryModeOutcome(
  query: DiscoverySearchRequest['query'],
  semanticReadiness?: SemanticDiscoveryReadiness,
  semanticUsed = false,
) {
  const requestedSearchMode = defaultSessionSearchMode(query)
  const partialCoverage = semanticReadiness?.status === 'partial'
  const degraded = requestedSearchMode === 'hybrid' && (!semanticUsed || partialCoverage)
  return {
    searchBackend: semanticUsed ? requestedSearchMode : ('lexical' as const),
    requestedSearchMode,
    ...(requestedSearchMode === 'lexical'
      ? {}
      : {
          semanticReadiness: semanticReadiness ?? {
            status: 'unavailable' as const,
            reason: 'The bundled semantic discovery projection is not prepared.',
          },
          ...(degraded
            ? {
                degradation: {
                  from: 'hybrid' as const,
                  to: 'lexical' as const,
                  reason: partialCoverage ? 'semantic_partial_coverage' : 'semantic_not_ready',
                },
              }
            : {}),
        }),
  }
}

export function discoveryCursorError(
  request: DiscoverySearchRequest,
  code: 'cursor_expired' | 'cursor_mismatch',
  message: string,
) {
  return sessionQueryResponse(request, { operation: 'search', error: { code, message } })
}

export function semanticDiscoveryNotReady(
  request: DiscoverySearchRequest,
  readiness: SemanticDiscoveryReadiness,
  message = 'Semantic Session discovery is not ready.',
) {
  return sessionQueryResponse(request, {
    operation: 'search',
    semanticReadiness: readiness,
    error: {
      code: 'semantic_not_ready',
      message,
    },
  })
}

export function discoveryWindowPage(
  request: DiscoverySearchRequest,
  window: SessionDiscoveryWindow,
  offset: number,
  authorizedIds: ReadonlySet<string>,
) {
  const sessions = []
  let nextOffset = offset
  while (nextOffset < window.entries.length && sessions.length < request.query.limit) {
    const entry = window.entries[nextOffset]
    nextOffset += 1
    if (entry && authorizedIds.has(entry.session.sessionId)) sessions.push(entry.session)
  }
  return sessionQueryResponse(request, {
    operation: 'search',
    sessions,
    ...window.modeOutcome,
    discoveryWindow: {
      size: window.entries.length,
      truncated: window.truncated,
      expiresAt: window.expiresAt,
    },
    ...(nextOffset < window.entries.length
      ? { nextCursor: encodeSessionQueryCursor({ windowId: window.id, offset: nextOffset }) }
      : {}),
  })
}

function discoveryField(value: string) {
  return value === 'title' ||
    value === 'objective' ||
    value === 'initial-objective' ||
    value === 'current-preview' ||
    value === 'transcript'
    ? value
    : undefined
}

export function discoveryWindowEntries(rows: readonly DiscoverySearchRow[]) {
  return rows.slice(0, SESSION_DISCOVERY_WINDOW_LIMIT).map((row, index) => ({
    session: {
      ...sessionQuerySummary(row),
      discoveryEvidence: {
        matchKind: row.exact_match === 1 ? ('exact' as const) : ('lexical' as const),
        matchedFields: row.matched_fields
          .split(',')
          .map(discoveryField)
          .filter((field): field is NonNullable<typeof field> => field !== undefined),
        ...(row.snippet ? { snippet: row.snippet } : {}),
        ...(row.transcript_node_id && row.transcript_created_order !== null
          ? {
              transcriptMatch: {
                nodeId: row.transcript_node_id,
                ...(row.transcript_run_id ? { runId: row.transcript_run_id } : {}),
                createdOrder: row.transcript_created_order,
              },
            }
          : {}),
        rank: index + 1,
      },
    },
  }))
}

interface FusedDiscoveryEntry {
  readonly session: SessionQuerySummary
  readonly lexicalRank?: number
  readonly semanticRank?: number
  readonly score: number
}

type DiscoveryEvidence = SessionQuerySummary['discoveryEvidence']

function mergedMatchedFields(existing: DiscoveryEvidence, semantic: DiscoveryEvidence) {
  return [...new Set([...(existing?.matchedFields ?? []), ...(semantic?.matchedFields ?? [])])]
}

function mergedDiscoveryEvidence(
  existing: DiscoveryEvidence,
  semantic: DiscoveryEvidence,
  semanticRank: number,
) {
  const transcriptMatch = existing?.transcriptMatch ?? semantic?.transcriptMatch
  return {
    ...existing,
    matchKind: existing?.matchKind ?? semantic?.matchKind ?? ('semantic' as const),
    matchedFields: mergedMatchedFields(existing, semantic),
    rank: existing?.rank ?? semantic?.rank ?? semanticRank,
    ...(transcriptMatch ? { transcriptMatch } : {}),
  }
}

function mergeSemanticSession(
  existing: FusedDiscoveryEntry | undefined,
  semantic: SessionQuerySummary,
  semanticRank: number,
) {
  if (!existing) return semantic
  const existingEvidence = existing.session.discoveryEvidence
  const semanticEvidence = semantic.discoveryEvidence
  return {
    ...existing.session,
    discoveryEvidence: mergedDiscoveryEvidence(existingEvidence, semanticEvidence, semanticRank),
  }
}

function fusedMatchKind(entry: FusedDiscoveryEntry) {
  if (entry.lexicalRank && entry.semanticRank) return 'hybrid' as const
  if (entry.semanticRank) return 'semantic' as const
  return entry.session.discoveryEvidence?.matchKind ?? ('lexical' as const)
}

function rankFusedEntry(entry: FusedDiscoveryEntry, index: number) {
  const evidence = entry.session.discoveryEvidence
  return {
    session: {
      ...entry.session,
      discoveryEvidence: {
        matchKind: fusedMatchKind(entry),
        matchedFields: evidence?.matchedFields ?? [],
        ...(evidence?.snippet ? { snippet: evidence.snippet } : {}),
        ...(evidence?.transcriptMatch ? { transcriptMatch: evidence.transcriptMatch } : {}),
        rank: index + 1,
      },
    },
  }
}

export function fuseDiscoveryEntries(
  lexical: ReturnType<typeof discoveryWindowEntries>,
  semantic: readonly { readonly session: SessionQuerySummary }[],
) {
  const fused = new Map<string, FusedDiscoveryEntry>()
  for (const [index, entry] of lexical.entries()) {
    fused.set(entry.session.sessionId, {
      session: entry.session,
      lexicalRank: index + 1,
      score:
        1 / (RECIPROCAL_RANK_FUSION_K + index + 1) +
        (entry.session.discoveryEvidence?.matchKind === 'exact' ? 1 : 0),
    })
  }
  for (const [index, entry] of semantic.entries()) {
    const existing = fused.get(entry.session.sessionId)
    fused.set(entry.session.sessionId, {
      session: mergeSemanticSession(existing, entry.session, index + 1),
      ...(existing?.lexicalRank ? { lexicalRank: existing.lexicalRank } : {}),
      semanticRank: index + 1,
      score: (existing?.score ?? 0) + 1 / (RECIPROCAL_RANK_FUSION_K + index + 1),
    })
  }
  return [...fused.values()]
    .toSorted(
      (left, right) =>
        right.score - left.score || left.session.sessionId.localeCompare(right.session.sessionId),
    )
    .slice(0, SESSION_DISCOVERY_WINDOW_LIMIT)
    .map(rankFusedEntry)
}

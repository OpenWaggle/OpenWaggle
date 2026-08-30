import type * as SqlClient from '@effect/sql/SqlClient'
import type { LocalSessionProfileAuthority } from '@shared/types/local-session-profile'
import * as Effect from 'effect/Effect'
import {
  SESSION_DISCOVERY_WINDOW_LIMIT,
  type SessionDiscoveryWindowStore,
} from './session-discovery-window-store'
import {
  discoveryCursor,
  selectDiscoveryEntries,
  semanticFreshnessFailure,
} from './sqlite-session-discovery-selection'
import {
  type DiscoverySearchRequest,
  type DiscoverySearchRow,
  defaultSessionSearchMode,
  discoveryCursorError,
  discoveryModeOutcome,
  discoveryWindowIdentity,
  discoveryWindowPage,
  semanticDiscoveryNotReady,
} from './sqlite-session-discovery-window'
import { loadLexicalDiscoveryRows } from './sqlite-session-lexical-search'
import {
  authorizedSessionScope,
  invalidSessionQueryCursor,
  sessionQueryResponse,
} from './sqlite-session-query-support'
import type { SqliteSessionSemanticSearch } from './sqlite-session-semantic-search'
import {
  loadSelectedSemanticEntries,
  prepareSemanticSearch,
} from './sqlite-session-semantic-selection'
import type {
  SqliteSessionTranscriptSemanticSearch,
  TranscriptSemanticScope,
} from './sqlite-session-transcript-semantic-search'

function loadAuthorizedWindowIds(
  sql: SqlClient.SqlClient,
  authority: LocalSessionProfileAuthority | undefined,
  ids: readonly string[],
) {
  if (ids.length === 0) return Effect.succeed(new Set<string>())
  const allowed = authorizedSessionScope(authority)
  return sql<{ readonly session_id: string }>`
    SELECT sessions.id AS session_id FROM sessions
    LEFT JOIN session_spawn_lineage ON session_spawn_lineage.child_session_id = sessions.id
    WHERE sessions.id IN ${sql.in(ids)}
      AND (
        ${allowed.all} = 1
        OR sessions.project_path IN ${sql.in(allowed.projectPaths)}
        OR sessions.id IN ${sql.in(allowed.sessionIds)}
        OR COALESCE(session_spawn_lineage.hive_root_session_id, sessions.id)
          IN ${sql.in(allowed.hiveRootSessionIds)}
      )
  `.pipe(Effect.map((rows) => new Set(rows.map((row) => row.session_id))))
}

function loadLexicalRowsForMode(
  sql: SqlClient.SqlClient,
  authority: LocalSessionProfileAuthority | undefined,
  request: DiscoverySearchRequest,
  mode: DiscoverySearchRequest['query']['mode'],
) {
  return mode === 'semantic'
    ? Effect.succeed<readonly DiscoverySearchRow[]>([])
    : loadLexicalDiscoveryRows(sql, authority, request)
}

function resumeDiscoveryWindow(input: {
  readonly sql: SqlClient.SqlClient
  readonly authority: LocalSessionProfileAuthority | undefined
  readonly request: DiscoverySearchRequest
  readonly windows: SessionDiscoveryWindowStore
  readonly cursor: { readonly windowId: string; readonly offset: number }
  readonly identity: ReturnType<typeof discoveryWindowIdentity>
  readonly now: number
}) {
  const found = input.windows.read({ ...input.identity, id: input.cursor.windowId, now: input.now })
  if (found.status === 'expired') {
    return Effect.succeed(
      discoveryCursorError(input.request, 'cursor_expired', 'The discovery window expired.'),
    )
  }
  if (
    found.status === 'mismatch' ||
    !Number.isSafeInteger(input.cursor.offset) ||
    input.cursor.offset < 0
  ) {
    return Effect.succeed(
      discoveryCursorError(input.request, 'cursor_mismatch', 'The cursor is caller-bound.'),
    )
  }
  return loadAuthorizedWindowIds(
    input.sql,
    input.authority,
    found.window.entries.map((entry) => entry.session.sessionId),
  ).pipe(
    Effect.map((ids) => discoveryWindowPage(input.request, found.window, input.cursor.offset, ids)),
  )
}

export function searchSessions(
  sql: SqlClient.SqlClient,
  authority: LocalSessionProfileAuthority | undefined,
  request: DiscoverySearchRequest,
  windows: SessionDiscoveryWindowStore,
  semantic: SqliteSessionSemanticSearch,
  transcriptSemantic: SqliteSessionTranscriptSemanticSearch,
  callerId?: string,
) {
  const cursor = discoveryCursor(request)
  if (cursor === 'invalid') return Effect.succeed(invalidSessionQueryCursor(request))
  const identity = discoveryWindowIdentity(request, authority, callerId)
  if (cursor) {
    const now = Date.now()
    return resumeDiscoveryWindow({ sql, authority, request, windows, cursor, identity, now })
  }
  if (!request.query.query.trim()) {
    return Effect.succeed(
      sessionQueryResponse(request, {
        operation: 'search',
        sessions: [],
        ...discoveryModeOutcome(request.query),
      }),
    )
  }
  let leasedScope: TranscriptSemanticScope | undefined
  return Effect.gen(function* () {
    const mode = defaultSessionSearchMode(request.query)
    const semanticSelection = yield* prepareSemanticSearch({
      mode,
      authority,
      request,
      discovery: semantic,
      transcript: transcriptSemantic,
    })
    leasedScope = semanticSelection.scope
    const freshnessFailure = semanticFreshnessFailure(
      request,
      semanticSelection.fresh,
      semanticSelection.publicReadiness,
    )
    if (freshnessFailure) return freshnessFailure
    if (mode === 'semantic' && semanticSelection.readiness && !semanticSelection.usable) {
      return semanticDiscoveryNotReady(
        request,
        semanticSelection.publicReadiness ?? semanticSelection.readiness,
      )
    }
    const lexicalRows = yield* loadLexicalRowsForMode(sql, authority, request, mode)
    const semanticEntries = yield* loadSelectedSemanticEntries({
      query: request.query.query.trim(),
      authority,
      request,
      discovery: semantic,
      transcript: transcriptSemantic,
      scope: semanticSelection.scope,
      readiness: semanticSelection.readiness,
      usable: semanticSelection.usable,
    })
    const entries = selectDiscoveryEntries(
      mode,
      semanticSelection.usable,
      lexicalRows,
      semanticEntries,
    )
    const window = windows.create({
      ...identity,
      entries,
      truncated:
        (semanticSelection.scope?.truncated ?? false) ||
        semanticSelection.readiness?.status === 'partial' ||
        lexicalRows.length > SESSION_DISCOVERY_WINDOW_LIMIT ||
        semanticEntries.length > SESSION_DISCOVERY_WINDOW_LIMIT,
      modeOutcome: discoveryModeOutcome(
        request.query,
        semanticSelection.publicReadiness,
        semanticSelection.usable,
      ),
      now: Date.now(),
    })
    return discoveryWindowPage(
      request,
      window,
      0,
      new Set(window.entries.map((entry) => entry.session.sessionId)),
    )
  }).pipe(
    Effect.ensuring(
      Effect.suspend(() =>
        leasedScope ? transcriptSemantic.releaseScope(leasedScope).pipe(Effect.orDie) : Effect.void,
      ),
    ),
  )
}

import { randomUUID } from 'node:crypto'
import type * as SqlClient from '@effect/sql/SqlClient'
import type { SqlError } from '@effect/sql/SqlError'
import type { LocalSessionProfileAuthority } from '@shared/types/local-session-profile'
import type { SemanticDiscoveryReadiness, SessionQuerySummary } from '@shared/types/session-query'
import * as Effect from 'effect/Effect'
import { SESSION_TRANSCRIPT_SEMANTIC_STORAGE_POLICY as STORAGE_POLICY } from '../domain/session-transcript-semantic-storage-policy'
import type { SessionEmbeddingModel } from './multilingual-e5-session-embedding-model'
import { sessionSemanticQueryInferenceGate } from './session-semantic-inference-gate'
import { SessionTranscriptSemanticIndexCache } from './session-transcript-semantic-index-cache'
import type { DiscoverySearchRequest } from './sqlite-session-discovery-window'
import {
  authorizedSessionScope,
  type SessionQuerySummaryRow,
  sessionQuerySummary,
} from './sqlite-session-query-support'
import { SqliteSessionTranscriptSemanticProjection } from './sqlite-session-transcript-semantic-projection'
import {
  releaseTranscriptSemanticLease,
  touchTranscriptSemanticLease,
} from './sqlite-session-transcript-semantic-storage'

const TRANSCRIPT_SEMANTIC_SESSION_SCOPE_LIMIT = 1_000
const FRESHNESS_POLL_INTERVAL_MS = 100
const LEASE_HEARTBEAT_INTERVAL_MS = Math.floor(STORAGE_POLICY.leaseTtlMs / 4)

interface TranscriptMatchRow {
  readonly node_id: string
  readonly run_id: string | null
  readonly created_order: number
}

function loadEligibleSessionIds(
  sql: SqlClient.SqlClient,
  authority: LocalSessionProfileAuthority | undefined,
  request: DiscoverySearchRequest,
) {
  const allowed = authorizedSessionScope(authority)
  const includeArchived = request.query.includeArchived ? 1 : 0
  return sql<{ readonly session_id: string }>`
    SELECT sessions.id AS session_id
    FROM sessions
    LEFT JOIN session_spawn_lineage ON session_spawn_lineage.child_session_id = sessions.id
    WHERE (${includeArchived} = 1 OR sessions.archived = 0)
      AND (${request.query.projectPath ?? null} IS NULL
        OR sessions.project_path = ${request.query.projectPath ?? null})
      AND (${request.query.workingPath ?? null} IS NULL OR EXISTS (
        SELECT 1 FROM session_workspace_bindings AS catalog_binding
        JOIN workspace_resources AS catalog_workspace ON catalog_workspace.id = catalog_binding.workspace_id
        WHERE catalog_binding.session_id = sessions.id
          AND catalog_workspace.working_path = ${request.query.workingPath ?? null}
      ))
      AND (${allowed.all} = 1 OR sessions.project_path IN ${sql.in(allowed.projectPaths)}
        OR sessions.id IN ${sql.in(allowed.sessionIds)}
        OR COALESCE(session_spawn_lineage.hive_root_session_id, sessions.id)
          IN ${sql.in(allowed.hiveRootSessionIds)})
    ORDER BY sessions.updated_at DESC, sessions.id
    LIMIT ${TRANSCRIPT_SEMANTIC_SESSION_SCOPE_LIMIT + 1}
  `
}

function loadSessionRows(sql: SqlClient.SqlClient, sessionIds: readonly string[]) {
  if (sessionIds.length === 0) return Effect.succeed<readonly SessionQuerySummaryRow[]>([])
  return sql<SessionQuerySummaryRow>`
    SELECT sessions.id AS session_id, sessions.title, sessions.project_path, sessions.archived,
      sessions.created_at, sessions.updated_at,
      session_spawn_lineage.parent_session_id, session_spawn_lineage.hive_root_session_id,
      (SELECT COUNT(*) FROM session_spawn_lineage AS direct_lineage
        WHERE direct_lineage.parent_session_id = sessions.id) AS direct_worker_count,
      session_execution_profiles.profile_json, delegation_contracts.id AS delegation_id,
      delegation_contracts.state AS delegation_state
    FROM sessions
    LEFT JOIN session_spawn_lineage ON session_spawn_lineage.child_session_id = sessions.id
    LEFT JOIN session_execution_profiles ON session_execution_profiles.session_id = sessions.id
    LEFT JOIN delegation_contracts ON delegation_contracts.child_session_id = sessions.id
    WHERE sessions.id IN ${sql.in(sessionIds)}
  `
}

function loadTranscriptMatches(sql: SqlClient.SqlClient, nodeIds: readonly string[]) {
  if (nodeIds.length === 0) return Effect.succeed<readonly TranscriptMatchRow[]>([])
  return sql<TranscriptMatchRow>`
    SELECT id AS node_id,
      json_extract(metadata_json, '$.openWaggle.runId') AS run_id,
      created_order
    FROM session_nodes WHERE id IN ${sql.in(nodeIds)}
  `
}

export interface TranscriptSemanticScope {
  readonly sessionIds: readonly string[]
  readonly truncated: boolean
  readonly operationId?: string
}

export class SqliteSessionTranscriptSemanticSearch {
  readonly projection: SqliteSessionTranscriptSemanticProjection
  readonly #indexCache: SessionTranscriptSemanticIndexCache

  constructor(
    private readonly sql: SqlClient.SqlClient,
    private readonly model: SessionEmbeddingModel,
  ) {
    this.projection = new SqliteSessionTranscriptSemanticProjection(sql, model)
    this.#indexCache = new SessionTranscriptSemanticIndexCache(sql, model)
  }

  prepareScope(
    authority: LocalSessionProfileAuthority | undefined,
    request: DiscoverySearchRequest,
  ) {
    return Effect.gen(this, function* () {
      const operationId = randomUUID()
      const rows = yield* loadEligibleSessionIds(this.sql, authority, request)
      const truncated = rows.length > TRANSCRIPT_SEMANTIC_SESSION_SCOPE_LIMIT
      const sessionIds = rows
        .slice(0, TRANSCRIPT_SEMANTIC_SESSION_SCOPE_LIMIT)
        .map((row) => row.session_id)
      yield* this.projection.ensureSessions(sessionIds, operationId)
      return { sessionIds, truncated, operationId } satisfies TranscriptSemanticScope
    })
  }

  readiness(scope: TranscriptSemanticScope): Effect.Effect<SemanticDiscoveryReadiness, SqlError> {
    return this.projection.readiness(scope.sessionIds)
  }

  usable(readiness: SemanticDiscoveryReadiness) {
    return (
      (readiness.status === 'ready' ||
        (readiness.status === 'partial' && (readiness.coverage ?? 0) > 0)) &&
      readiness.modelRevision === this.model.metadata.revision &&
      (readiness.pendingCount ?? 0) === 0
    )
  }

  fresh(readiness: SemanticDiscoveryReadiness) {
    return readiness.status === 'partial' || this.usable(readiness)
  }

  waitForFresh(
    scope: TranscriptSemanticScope,
    initial: SemanticDiscoveryReadiness,
    timeoutMs: number,
  ) {
    if (this.fresh(initial) || timeoutMs <= 0 || initial.status === 'failed') {
      return Effect.succeed(initial)
    }
    const now = Date.now()
    return this.#waitForFreshUntil(scope, now + timeoutMs, now + LEASE_HEARTBEAT_INTERVAL_MS)
  }

  search(query: string, scope: TranscriptSemanticScope, limit: number) {
    return Effect.gen(this, function* () {
      if (scope.operationId) {
        yield* touchTranscriptSemanticLease({
          sql: this.sql,
          sessionIds: scope.sessionIds,
          operationId: scope.operationId,
        })
      }
      const index = yield* this.#loadScopeIndex(scope)
      const vectors = yield* Effect.tryPromise({
        try: (signal) =>
          sessionSemanticQueryInferenceGate.run(() => this.model.embedQueries([query]), signal),
        catch: (cause) => new Error('Semantic transcript query embedding failed.', { cause }),
      })
      const vector = vectors[0]
      if (!vector) return []
      const matches = index.searchGrouped(vector, limit, new Set(scope.sessionIds))
      const rows = yield* loadSessionRows(
        this.sql,
        matches.map((match) => match.sessionId),
      )
      const summaries = new Map<string, SessionQuerySummary>(
        rows.map((row) => [row.session_id, sessionQuerySummary(row)]),
      )
      const transcriptRows = yield* loadTranscriptMatches(
        this.sql,
        matches.flatMap((match) => (match.matchedRecordId ? [match.matchedRecordId] : [])),
      )
      const transcriptMatches = new Map(transcriptRows.map((row) => [row.node_id, row]))
      return matches.flatMap((match, index) => {
        const session = summaries.get(match.sessionId)
        const transcriptMatch = match.matchedRecordId
          ? transcriptMatches.get(match.matchedRecordId)
          : undefined
        return session
          ? [
              {
                session: {
                  ...session,
                  discoveryEvidence: {
                    matchKind: 'semantic' as const,
                    matchedFields: ['transcript' as const],
                    rank: index + 1,
                    ...(transcriptMatch
                      ? {
                          transcriptMatch: {
                            nodeId: transcriptMatch.node_id,
                            ...(transcriptMatch.run_id ? { runId: transcriptMatch.run_id } : {}),
                            createdOrder: transcriptMatch.created_order,
                          },
                        }
                      : {}),
                  },
                },
              },
            ]
          : []
      })
    })
  }

  releaseScope(scope: TranscriptSemanticScope) {
    return scope.operationId
      ? releaseTranscriptSemanticLease({ sql: this.sql, operationId: scope.operationId })
      : Effect.void
  }

  #loadScopeIndex(scope: TranscriptSemanticScope) {
    return this.#indexCache.load(scope.sessionIds)
  }

  #waitForFreshUntil(
    scope: TranscriptSemanticScope,
    deadline: number,
    nextLeaseHeartbeatAt: number,
  ): Effect.Effect<SemanticDiscoveryReadiness, SqlError> {
    return Effect.gen(this, function* () {
      const now = Date.now()
      let followingHeartbeatAt = nextLeaseHeartbeatAt
      if (scope.operationId && now >= nextLeaseHeartbeatAt) {
        yield* touchTranscriptSemanticLease({
          sql: this.sql,
          sessionIds: scope.sessionIds,
          operationId: scope.operationId,
          now,
        })
        followingHeartbeatAt = now + LEASE_HEARTBEAT_INTERVAL_MS
      }
      const readiness = yield* this.readiness(scope)
      const remainingMs = deadline - Date.now()
      if (this.fresh(readiness) || readiness.status === 'failed' || remainingMs <= 0) {
        return readiness
      }
      const heartbeatDelay = Math.max(1, followingHeartbeatAt - Date.now())
      yield* Effect.sleep(Math.min(FRESHNESS_POLL_INTERVAL_MS, remainingMs, heartbeatDelay))
      return yield* this.#waitForFreshUntil(scope, deadline, followingHeartbeatAt)
    })
  }
}

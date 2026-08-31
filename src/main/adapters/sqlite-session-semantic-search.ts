import type * as SqlClient from '@effect/sql/SqlClient'
import type { LocalSessionProfileAuthority } from '@shared/types/local-session-profile'
import type { SemanticDiscoveryReadiness, SessionQuerySummary } from '@shared/types/session-query'
import * as Effect from 'effect/Effect'
import type { SessionEmbeddingModel } from './multilingual-e5-session-embedding-model'
import { decodeFloat32Vector, SessionFlatVectorIndex } from './session-flat-vector-index'
import { sessionSemanticQueryInferenceGate } from './session-semantic-inference-gate'
import type { DiscoverySearchRequest } from './sqlite-session-discovery-window'
import {
  authorizedSessionScope,
  type SessionQuerySummaryRow,
  sessionQuerySummary,
} from './sqlite-session-query-support'
import { SqliteSessionSemanticProjection } from './sqlite-session-semantic-projection'

interface StoredVectorRow {
  readonly session_id: string
  readonly dimensions: number
  readonly vector: Uint8Array
}

const FRESHNESS_POLL_INTERVAL_MS = 50

function loadEligibleSemanticSessionIds(
  sql: SqlClient.SqlClient,
  authority: LocalSessionProfileAuthority | undefined,
  request: DiscoverySearchRequest,
) {
  const allowed = authorizedSessionScope(authority)
  const includeArchived = request.query.includeArchived ? 1 : 0
  return sql<{ readonly session_id: string }>`
    SELECT sessions.id AS session_id
    FROM sessions
    JOIN session_discovery_embeddings ON session_discovery_embeddings.session_id = sessions.id
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
  `
}

function loadSemanticSessionRows(sql: SqlClient.SqlClient, sessionIds: readonly string[]) {
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

export class SqliteSessionSemanticSearch {
  readonly projection: SqliteSessionSemanticProjection
  readonly #index = new SessionFlatVectorIndex()
  #loadedRevision = -1

  constructor(
    private readonly sql: SqlClient.SqlClient,
    private readonly model: SessionEmbeddingModel,
  ) {
    this.projection = new SqliteSessionSemanticProjection(sql, model)
  }

  readiness() {
    return this.projection.readiness()
  }

  usable(readiness: SemanticDiscoveryReadiness) {
    return (
      (readiness.snapshotRevision ?? 0) > 0 &&
      readiness.modelRevision === this.model.metadata.revision
    )
  }

  fresh(readiness: SemanticDiscoveryReadiness) {
    return (
      readiness.status === 'ready' && (readiness.pendingCount ?? 0) === 0 && this.usable(readiness)
    )
  }

  waitForFresh(initial: SemanticDiscoveryReadiness, timeoutMs: number) {
    if (this.fresh(initial) || timeoutMs <= 0 || initial.status === 'failed') {
      return Effect.succeed(initial)
    }
    const deadline = Date.now() + timeoutMs
    return this.#waitForFreshUntil(deadline)
  }

  search(
    query: string,
    authority: LocalSessionProfileAuthority | undefined,
    request: DiscoverySearchRequest,
    readiness: SemanticDiscoveryReadiness,
    limit: number,
  ) {
    return Effect.gen(this, function* () {
      yield* this.#refreshIndex(readiness.snapshotRevision ?? 0)
      const eligibleRows = yield* loadEligibleSemanticSessionIds(this.sql, authority, request)
      const vectors = yield* Effect.tryPromise({
        try: (signal) =>
          sessionSemanticQueryInferenceGate.run(() => this.model.embedQueries([query]), signal),
        catch: (cause) => new Error('Semantic Session query embedding failed.', { cause }),
      })
      const vector = vectors[0]
      if (!vector) return []
      const matches = this.#index.search(
        vector,
        limit,
        new Set(eligibleRows.map((row) => row.session_id)),
      )
      const rows = yield* loadSemanticSessionRows(
        this.sql,
        matches.map((match) => match.sessionId),
      )
      const summaries = new Map<string, SessionQuerySummary>(
        rows.map((row) => [row.session_id, sessionQuerySummary(row)]),
      )
      return matches.flatMap((match, index) => {
        const session = summaries.get(match.sessionId)
        return session
          ? [
              {
                session: {
                  ...session,
                  discoveryEvidence: {
                    matchKind: 'semantic' as const,
                    matchedFields: [],
                    rank: index + 1,
                  },
                },
              },
            ]
          : []
      })
    })
  }

  #refreshIndex(snapshotRevision: number) {
    if (snapshotRevision === this.#loadedRevision) return Effect.void
    return Effect.gen(this, function* () {
      const rebuild = this.#loadedRevision < 0 || snapshotRevision < this.#loadedRevision
      const rows = rebuild
        ? yield* this.sql<StoredVectorRow>`
            SELECT session_id, dimensions, vector FROM session_discovery_embeddings
            WHERE model_id = ${this.model.metadata.id}
              AND model_revision = ${this.model.metadata.revision}
          `
        : yield* this.sql<StoredVectorRow>`
            SELECT session_id, dimensions, vector FROM session_discovery_embeddings
            WHERE model_id = ${this.model.metadata.id}
              AND model_revision = ${this.model.metadata.revision}
              AND snapshot_revision > ${this.#loadedRevision}
          `
      const records = rows.map((row) => ({
        sessionId: row.session_id,
        vector: decodeFloat32Vector(row.vector, row.dimensions),
      }))
      if (rebuild) this.#index.replace(records)
      else {
        for (const record of records) this.#index.upsert(record)
        const retained = yield* this.sql<{ readonly session_id: string }>`
          SELECT session_id FROM session_discovery_embeddings
          WHERE model_id = ${this.model.metadata.id}
            AND model_revision = ${this.model.metadata.revision}
        `
        this.#index.retainOnly(new Set(retained.map((row) => row.session_id)))
      }
      this.#loadedRevision = snapshotRevision
    })
  }

  #waitForFreshUntil(deadline: number): ReturnType<SqliteSessionSemanticProjection['readiness']> {
    return this.readiness().pipe(
      Effect.flatMap((readiness) => {
        const remainingMs = deadline - Date.now()
        if (this.fresh(readiness) || readiness.status === 'failed' || remainingMs <= 0) {
          return Effect.succeed(readiness)
        }
        return Effect.sleep(Math.min(FRESHNESS_POLL_INTERVAL_MS, remainingMs)).pipe(
          Effect.flatMap(() => this.#waitForFreshUntil(deadline)),
        )
      }),
    )
  }
}

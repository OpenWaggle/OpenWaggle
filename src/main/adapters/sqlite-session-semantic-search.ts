import type * as SqlClient from '@effect/sql/SqlClient'
import type { LocalSessionProfileAuthority } from '@shared/types/local-session-profile'
import type { SemanticDiscoveryReadiness, SessionQuerySummary } from '@shared/types/session-query'
import * as Effect from 'effect/Effect'
import {
  SESSION_SEMANTIC_DISCOVERY_STORAGE_POLICY,
  type SessionSemanticDiscoveryStoragePolicy,
} from '../domain/session-semantic-discovery-storage-policy'
import type { SessionEmbeddingModel } from './multilingual-e5-session-embedding-model'
import { decodeFloat32Vector } from './session-flat-vector-index'
import {
  type SemanticIndexRefresh,
  SessionSemanticIndexSnapshotCache,
} from './session-semantic-index-snapshot-cache'
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

interface SemanticSessionFilter {
  readonly allowedSessionIds?: ReadonlySet<string>
  readonly excludedSessionIds?: ReadonlySet<string>
}

const FRESHNESS_POLL_INTERVAL_MS = 50

function loadEligibleSemanticSessionIds(
  sql: SqlClient.SqlClient,
  authority: LocalSessionProfileAuthority | undefined,
  request: DiscoverySearchRequest,
) {
  const allowed = authorizedSessionScope(authority)
  const includeArchived = request.query.includeArchived ? 1 : 0
  const hasCatalogFilter = Boolean(request.query.projectPath || request.query.workingPath)
  if (allowed.all === 1 && !hasCatalogFilter) {
    if (includeArchived === 1) return Effect.succeed<SemanticSessionFilter>({})
    return sql<{ readonly session_id: string }>`
      SELECT session_id FROM session_discovery_embeddings
      JOIN sessions ON sessions.id = session_discovery_embeddings.session_id
      WHERE sessions.archived = 1
    `.pipe(
      Effect.map((rows) => ({
        excludedSessionIds: new Set(rows.map((row) => row.session_id)),
      })),
    )
  }
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
  `.pipe(
    Effect.map((rows) => ({
      allowedSessionIds: new Set(rows.map((row) => row.session_id)),
    })),
  )
}

export { SessionSemanticIndexSnapshotCache } from './session-semantic-index-snapshot-cache'

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
  readonly #snapshots: SessionSemanticIndexSnapshotCache

  constructor(
    private readonly sql: SqlClient.SqlClient,
    private readonly model: SessionEmbeddingModel,
    private readonly storagePolicy: SessionSemanticDiscoveryStoragePolicy = SESSION_SEMANTIC_DISCOVERY_STORAGE_POLICY,
  ) {
    this.projection = new SqliteSessionSemanticProjection(sql, model, storagePolicy)
    this.#snapshots = new SessionSemanticIndexSnapshotCache(storagePolicy.recordLimit)
  }

  readiness() {
    return this.projection.readiness()
  }

  diagnostics() {
    return this.#snapshots.diagnostics()
  }

  usable(readiness: SemanticDiscoveryReadiness) {
    return (
      (readiness.snapshotRevision ?? 0) > 0 &&
      readiness.modelRevision === this.model.metadata.revision
    )
  }

  fresh(readiness: SemanticDiscoveryReadiness) {
    return (
      (readiness.status === 'ready' || readiness.status === 'partial') &&
      (readiness.pendingCount ?? 0) === 0 &&
      this.usable(readiness)
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
      const sessionFilter = yield* loadEligibleSemanticSessionIds(this.sql, authority, request)
      const vectors = yield* Effect.tryPromise({
        try: (signal) =>
          sessionSemanticQueryInferenceGate.run(() => this.model.embedQueries([query]), signal),
        catch: (cause) => new Error('Semantic Session query embedding failed.', { cause }),
      })
      const vector = vectors[0]
      if (!vector) return []
      const snapshot = yield* this.#snapshots.search({
        minimumRevision: readiness.snapshotRevision ?? 0,
        refresh: (afterRevision) => this.#loadIndexRefresh(afterRevision),
        acknowledge: (revision) => this.#acknowledgeIndexRevision(revision),
        query: vector,
        limit,
        ...sessionFilter,
      })
      const matches = snapshot.matches
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

  #loadIndexRefresh(afterRevision: number) {
    return this.sql.withTransaction(
      Effect.gen(this, function* () {
        const revisions = yield* this.sql<{
          readonly revision: number
          readonly deletion_compaction_revision: number
        }>`
          SELECT MAX(
            COALESCE((
              SELECT MAX(snapshot_revision) FROM session_discovery_embeddings
              WHERE model_id = ${this.model.metadata.id}
                AND model_revision = ${this.model.metadata.revision}
            ), 0),
            COALESCE((
              SELECT snapshot_revision FROM session_semantic_discovery_state
              WHERE singleton = 1 AND model_id = ${this.model.metadata.id}
                AND model_revision = ${this.model.metadata.revision}
            ), 0)
          ) AS revision,
          COALESCE((
            SELECT deletion_compaction_revision FROM session_semantic_discovery_state
            WHERE singleton = 1
          ), 0) AS deletion_compaction_revision
        `
        const revision = revisions[0]?.revision ?? 0
        const deletionCompactionRevision = revisions[0]?.deletion_compaction_revision ?? 0
        const rebuild = afterRevision < 0 || afterRevision < deletionCompactionRevision
        if (revision <= afterRevision) {
          return {
            revision,
            rebuild: false,
            records: [],
            deletedSessionIds: [],
          } satisfies SemanticIndexRefresh
        }
        const rows = rebuild
          ? yield* this.sql<StoredVectorRow>`
              SELECT session_id, dimensions, vector FROM session_discovery_embeddings
              WHERE model_id = ${this.model.metadata.id}
                AND model_revision = ${this.model.metadata.revision}
              LIMIT ${this.storagePolicy.recordLimit + 1}
            `
          : yield* this.sql<StoredVectorRow>`
              SELECT session_id, dimensions, vector FROM session_discovery_embeddings
              WHERE model_id = ${this.model.metadata.id}
                AND model_revision = ${this.model.metadata.revision}
                AND snapshot_revision > ${afterRevision}
              LIMIT ${this.storagePolicy.recordLimit + 1}
            `
        const deleted = rebuild
          ? []
          : yield* this.sql<{ readonly session_id: string }>`
              SELECT session_id FROM session_discovery_embedding_deletions
              WHERE snapshot_revision > ${afterRevision}
              ORDER BY snapshot_revision, session_id
            `
        return {
          revision,
          rebuild,
          records: rows.map((row) => ({
            sessionId: row.session_id,
            vector: decodeFloat32Vector(row.vector, row.dimensions),
          })),
          deletedSessionIds: deleted.map((row) => row.session_id),
        } satisfies SemanticIndexRefresh
      }),
    )
  }

  #acknowledgeIndexRevision(revision: number) {
    return this.sql.withTransaction(
      Effect.gen(this, function* () {
        yield* this.sql`
          UPDATE session_semantic_discovery_state
          SET deletion_compaction_revision = MAX(deletion_compaction_revision, ${revision})
          WHERE singleton = 1
        `
        yield* this.sql`
          DELETE FROM session_discovery_embedding_deletions
          WHERE snapshot_revision <= ${revision}
        `
      }),
    )
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

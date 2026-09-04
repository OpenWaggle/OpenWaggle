import { DatabaseSync } from 'node:sqlite'
import * as SqlClient from '@effect/sql/SqlClient'
import * as Effect from 'effect/Effect'
import type { SessionEmbeddingModel } from '../src/main/adapters/multilingual-e5-session-embedding-model'
import { SqliteSessionSemanticProjection } from '../src/main/adapters/sqlite-session-semantic-projection'
import { SqliteSessionTranscriptSemanticProjection } from '../src/main/adapters/sqlite-session-transcript-semantic-projection'
import { CURRENT_SESSION_SCHEMA_STATEMENTS } from '../src/main/services/database-schema'
import {
  applyIncrementalSessionTranscriptTerms,
  prepareIncrementalSessionTranscriptTerms,
} from '../src/main/services/session-transcript-term-incremental-projection'
import { sessionDiscoveryBenchmarkQueryExecutor } from './benchmark-session-discovery-runtime'

export { benchmarkSessionDiscoveryQueries } from './benchmark-session-discovery-queries'
const TIMING_DECIMAL_PLACES = 2

export function reportSessionDiscoveryBenchmarkPhase(phase: string, elapsedMs: number) {
  process.stderr.write(
    `[session-database-benchmark] ${phase}: ${elapsedMs.toFixed(TIMING_DECIMAL_PLACES)}ms\n`,
  )
}

export function initializeSessionDiscoveryBenchmarkSource(database: DatabaseSync) {
  database.exec('PRAGMA journal_mode = OFF; PRAGMA synchronous = OFF; PRAGMA temp_store = FILE;')
  database.exec('PRAGMA cache_size = -131072; PRAGMA foreign_keys = ON;')
  database.exec(`
    CREATE TABLE _migrations (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    );
    INSERT INTO _migrations VALUES (25, 'session-authorization-mode-override', 'now');
    CREATE TABLE settings_store (
      key TEXT PRIMARY KEY,
      value_json TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );
    INSERT INTO settings_store VALUES ('selectedModel', '"benchmark/model"', 1);
    INSERT INTO settings_store VALUES ('thinkingLevel', '"medium"', 1);
    INSERT INTO settings_store VALUES ('defaultAuthorizationMode', '"ask-for-approval"', 1);
  `)
  for (const statement of CURRENT_SESSION_SCHEMA_STATEMENTS) database.exec(statement)
}

function benchmarkCount(database: DatabaseSync, query: string) {
  const row = database.prepare(query).get()
  return typeof row === 'object' && row !== null && 'count' in row ? Number(row.count) : 0
}

export function sessionDiscoveryBenchmarkCounts(database: DatabaseSync) {
  return {
    sessions: benchmarkCount(database, 'SELECT COUNT(*) AS count FROM sessions'),
    messages: benchmarkCount(database, 'SELECT COUNT(*) AS count FROM session_nodes'),
    discoveryRows: benchmarkCount(
      database,
      'SELECT COUNT(*) AS count FROM session_node_discovery_search',
    ),
    activeBranchMessages: benchmarkCount(
      database,
      `WITH RECURSIVE selected_path(id) AS (
        SELECT branches.head_node_id
        FROM sessions
        JOIN session_branches AS branches ON branches.id = sessions.last_active_branch_id
        WHERE sessions.id = 'session-000000'
        UNION ALL
        SELECT nodes.parent_id
        FROM session_nodes AS nodes
        JOIN selected_path ON selected_path.id = nodes.id
        WHERE nodes.parent_id IS NOT NULL
      ) SELECT COUNT(*) AS count FROM selected_path`,
    ),
  }
}

export async function benchmarkCommonTermIncrementalProjection(
  databasePath: string,
  sessionId = 'session-000000',
) {
  const runtime = sessionDiscoveryBenchmarkQueryExecutor(databasePath)
  const nodeId = 'benchmark-common-term-incremental-node'
  try {
    return await runtime.run(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        const parents = yield* sql<{
          readonly parent_id: string
          readonly path_depth: number
          readonly created_order: number
        }>`
          SELECT sessions.last_active_node_id AS parent_id,
            parent.path_depth + 1 AS path_depth,
            (SELECT COALESCE(MAX(created_order), -1) + 1
              FROM session_nodes WHERE session_id = sessions.id) AS created_order
          FROM sessions
          JOIN session_nodes AS parent ON parent.id = sessions.last_active_node_id
          WHERE sessions.id = ${sessionId}
        `
        const parent = parents[0]
        if (!parent) return yield* Effect.fail(new Error('Benchmark session has no active node.'))
        const occurrencesBefore = yield* sql<{ readonly occurrences: number }>`
          SELECT occurrences FROM session_transcript_terms
          WHERE session_id = ${sessionId} AND term = ${'commonterm'}
        `
        const startedAt = performance.now()
        yield* sql.withTransaction(
          Effect.gen(function* () {
            yield* prepareIncrementalSessionTranscriptTerms(sql, sessionId, [nodeId])
            yield* sql`
              INSERT INTO session_nodes (
                id, session_id, parent_id, pi_entry_type, kind, role, timestamp_ms,
                content_json, metadata_json, branch_hint_id, path_depth, created_order
              ) VALUES (
                ${nodeId}, ${sessionId}, ${parent.parent_id}, ${'message'}, ${'message'},
                ${'assistant'}, ${parent.created_order},
                ${JSON.stringify({
                  parts: [{ type: 'text', text: 'commonterm post cutover incremental projection' }],
                })}, ${'{}'}, ${`${sessionId}:main`}, ${parent.path_depth},
                ${parent.created_order}
              )
            `
            yield* applyIncrementalSessionTranscriptTerms(sql, sessionId, [nodeId])
          }),
        )
        const elapsedMs = performance.now() - startedAt
        const occurrencesAfter = yield* sql<{ readonly occurrences: number }>`
          SELECT occurrences FROM session_transcript_terms
          WHERE session_id = ${sessionId} AND term = ${'commonterm'}
        `
        yield* sql.withTransaction(
          Effect.gen(function* () {
            yield* prepareIncrementalSessionTranscriptTerms(sql, sessionId, [nodeId])
            yield* sql`DELETE FROM session_nodes WHERE id = ${nodeId}`
            yield* applyIncrementalSessionTranscriptTerms(sql, sessionId, [nodeId])
          }),
        )
        return {
          elapsedMs,
          occurrenceDelta:
            (occurrencesAfter[0]?.occurrences ?? 0) - (occurrencesBefore[0]?.occurrences ?? 0),
        }
      }),
    )
  } finally {
    await runtime.dispose()
  }
}

export async function benchmarkSessionDiscoveryBackfills(
  databasePath: string,
  model: SessionEmbeddingModel,
) {
  const runtime = sessionDiscoveryBenchmarkQueryExecutor(databasePath)
  try {
    const discoveryStartedAt = performance.now()
    const discovery = await runtime.run(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        const projection = new SqliteSessionSemanticProjection(sql, model)
        let prepared = 0
        while (true) {
          const batch = yield* projection.prepareNextBatch()
          if (batch.prepared === 0) break
          prepared += batch.prepared
        }
        return { prepared, readiness: yield* projection.readiness() }
      }),
    )
    const discoveryElapsedMs = performance.now() - discoveryStartedAt
    const transcriptStartedAt = performance.now()
    const transcript = await runtime.run(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        const projection = new SqliteSessionTranscriptSemanticProjection(sql, model)
        yield* projection.ensureSessions(['session-000000'])
        let prepared = 0
        while (true) {
          const batch = yield* projection.prepareNextBatch()
          if (batch.prepared === 0) break
          prepared += batch.prepared
        }
        const counts = yield* sql<{
          readonly embeddings: number
          readonly pending: number
          readonly eligible: number
        }>`
          SELECT
            (SELECT COUNT(*) FROM session_transcript_embeddings
              WHERE session_id = ${'session-000000'}) AS embeddings,
            (SELECT COUNT(*) FROM session_transcript_embedding_queue
              WHERE session_id = ${'session-000000'}) AS pending,
            (SELECT eligible_node_count FROM session_transcript_semantic_scopes
              WHERE session_id = ${'session-000000'}) AS eligible
        `
        return { prepared, counts: counts[0] ?? { embeddings: 0, pending: 0, eligible: 0 } }
      }),
    )
    return {
      discovery: { elapsedMs: discoveryElapsedMs, ...discovery },
      transcript: { elapsedMs: performance.now() - transcriptStartedAt, ...transcript },
    }
  } finally {
    await runtime.dispose()
  }
}

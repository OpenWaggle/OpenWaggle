import { DatabaseSync } from 'node:sqlite'
import * as SqlClient from '@effect/sql/SqlClient'
import { SqliteClient } from '@effect/sql-sqlite-node'
import { SESSION_QUERY_CONTRACT_VERSION } from '@shared/types/session-query'
import * as Effect from 'effect/Effect'
import * as ManagedRuntime from 'effect/ManagedRuntime'
import type { SessionEmbeddingModel } from '../src/main/adapters/multilingual-e5-session-embedding-model'
import { loadLexicalDiscoveryRows } from '../src/main/adapters/sqlite-session-lexical-search'
import { listSessions } from '../src/main/adapters/sqlite-session-query-catalog'
import { readItems } from '../src/main/adapters/sqlite-session-query-items'
import { SqliteSessionSemanticProjection } from '../src/main/adapters/sqlite-session-semantic-projection'
import { SqliteSessionTranscriptSemanticProjection } from '../src/main/adapters/sqlite-session-transcript-semantic-projection'
import { CURRENT_SESSION_SCHEMA_STATEMENTS } from '../src/main/services/database-schema'
import { SQLITE_PREPARE_CACHE_SIZE } from '../src/main/services/database-constants'

const MEASURED_RUNS = 20
const WARMUP_RUNS = 3
const PAGE_SIZE = 50
const P95 = 0.95

export function benchmarkPercentile(values: readonly number[], fraction: number) {
  const sorted = values.toSorted((left, right) => left - right)
  const index = Math.max(0, Math.ceil(sorted.length * fraction) - 1)
  return sorted[index] ?? 0
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

export function sessionDiscoveryBenchmarkQueryExecutor(databasePath: string) {
  const runtime = ManagedRuntime.make(
    SqliteClient.layer({ filename: databasePath, prepareCacheSize: SQLITE_PREPARE_CACHE_SIZE }),
  )
  return {
    run: <A, E>(effect: Effect.Effect<A, E, SqlClient.SqlClient>) => runtime.runPromise(effect),
    dispose: () => runtime.dispose(),
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

async function measure(run: () => Promise<unknown>) {
  const timings: number[] = []
  for (let iteration = 0; iteration < WARMUP_RUNS + MEASURED_RUNS; iteration += 1) {
    const startedAt = performance.now()
    await run()
    const elapsed = performance.now() - startedAt
    if (iteration >= WARMUP_RUNS) timings.push(elapsed)
  }
  return { p95Ms: benchmarkPercentile(timings, P95), timings }
}

export async function benchmarkSessionDiscoveryQueries(
  databasePath: string,
  sparseWorkingPath: string,
) {
  const runtime = sessionDiscoveryBenchmarkQueryExecutor(databasePath)
  const list = (workingPath?: string) =>
    runtime.run(
      Effect.flatMap(SqlClient.SqlClient, (sql) =>
        listSessions(sql, undefined, {
          contractVersion: SESSION_QUERY_CONTRACT_VERSION,
          requestId: 'benchmark-list',
          query: {
            operation: 'list',
            limit: PAGE_SIZE,
            ...(workingPath ? { workingPath } : {}),
          },
        }),
      ),
    )
  const lexical = (query: string, requestId: string) =>
    runtime.run(
      Effect.flatMap(SqlClient.SqlClient, (sql) =>
        loadLexicalDiscoveryRows(sql, undefined, {
          contractVersion: SESSION_QUERY_CONTRACT_VERSION,
          requestId,
          query: { operation: 'search', query, limit: PAGE_SIZE, mode: 'lexical' },
        }),
      ),
    )
  const transcript = () =>
    runtime.run(
      Effect.flatMap(SqlClient.SqlClient, (sql) =>
        readItems(sql, {
          contractVersion: SESSION_QUERY_CONTRACT_VERSION,
          requestId: 'benchmark-transcript',
          query: { operation: 'items', sessionId: 'session-000000', limit: PAGE_SIZE },
        }),
      ),
    )
  const coldStartedAt = performance.now()
  await list(sparseWorkingPath)
  const coldWorkingPathListMs = performance.now() - coldStartedAt
  try {
    return {
      coldWorkingPathListMs,
      list: await measure(() => list()),
      sparseWorkingPathList: await measure(() => list(sparseWorkingPath)),
      missingWorkingPathList: await measure(() => list('/benchmark/missing')),
      lexical: await measure(() => lexical('benchmarktoken', 'benchmark-lexical')),
      commonLexical: await measure(() => lexical('commonterm', 'benchmark-common-lexical')),
      transcript: await measure(transcript),
    }
  } finally {
    await runtime.dispose()
  }
}

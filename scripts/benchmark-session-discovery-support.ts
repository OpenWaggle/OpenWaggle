import { DatabaseSync } from 'node:sqlite'
import * as SqlClient from '@effect/sql/SqlClient'
import { SqliteClient } from '@effect/sql-sqlite-node'
import * as Effect from 'effect/Effect'
import * as ManagedRuntime from 'effect/ManagedRuntime'
import { CURRENT_SESSION_SCHEMA_STATEMENTS } from '../src/main/services/database-schema'
import { SQLITE_PREPARE_CACHE_SIZE } from '../src/main/services/database-constants'
import { sessionTranscriptSearchContentSql } from '../src/main/services/session-host-search-schema'
import { SESSION_HOST_TARGET_SCHEMA_STATEMENTS } from '../src/main/services/session-host-target-schema'
import { SESSION_TRANSCRIPT_SEARCH_CHUNK_NODE_LIMIT } from '../src/main/services/session-transcript-search-projection'
import { populateSessionTranscriptTermCatalog } from '../src/main/session-host/session-transcript-term-cutover'

const BENCHMARK_TRANSCRIPT_SEARCH_CONTENT = sessionTranscriptSearchContentSql('session_nodes')

export function benchmarkPercentile(values: readonly number[], fraction: number) {
  const sorted = values.toSorted((left, right) => left - right)
  const index = Math.max(0, Math.ceil(sorted.length * fraction) - 1)
  return sorted[index] ?? 0
}

export function initializeSessionDiscoveryBenchmarkSchema(database: DatabaseSync) {
  database.exec('PRAGMA journal_mode = OFF; PRAGMA synchronous = OFF; PRAGMA temp_store = FILE;')
  database.exec('PRAGMA cache_size = -131072;')
  for (const statement of CURRENT_SESSION_SCHEMA_STATEMENTS) database.exec(statement)
}

export function initializeSessionDiscoveryBenchmarkTargetSchema(database: DatabaseSync) {
  for (const statement of SESSION_HOST_TARGET_SCHEMA_STATEMENTS) database.exec(statement)
}

export function populateSessionDiscoveryBenchmarkSearchIndexes(
  database: DatabaseSync,
) {
  database.exec(`
    INSERT INTO session_title_search (session_id, title)
    SELECT id, title FROM sessions;
    INSERT INTO session_node_search (session_id, node_id, content)
    SELECT session_id, id, ${BENCHMARK_TRANSCRIPT_SEARCH_CONTENT} FROM session_nodes;
    INSERT INTO session_node_search_rows (node_id, session_id, search_rowid)
    SELECT node_id, session_id, rowid FROM session_node_search;
    INSERT INTO session_node_discovery_search (session_id, node_id, content)
    SELECT session_id, id, ${BENCHMARK_TRANSCRIPT_SEARCH_CONTENT} FROM session_nodes;
    INSERT INTO session_transcript_search (session_id, chunk_ordinal, content)
    SELECT session_id, chunk_ordinal, GROUP_CONCAT(content, char(10))
    FROM (
      SELECT session_id, content,
        CAST((ROW_NUMBER() OVER (PARTITION BY session_id ORDER BY rowid) - 1) /
          ${SESSION_TRANSCRIPT_SEARCH_CHUNK_NODE_LIMIT} AS INTEGER) AS chunk_ordinal
      FROM session_node_search
    ) GROUP BY session_id, chunk_ordinal;
  `)
  populateSessionTranscriptTermCatalog(database)
}

export function sessionDiscoveryBenchmarkCounts(database: DatabaseSync) {
  const sessions = database.prepare('SELECT COUNT(*) AS count FROM sessions').get()
  const messages = database.prepare('SELECT COUNT(*) AS count FROM session_nodes').get()
  return {
    sessions:
      typeof sessions === 'object' && sessions !== null && 'count' in sessions
        ? Number(sessions.count)
        : 0,
    messages:
      typeof messages === 'object' && messages !== null && 'count' in messages
        ? Number(messages.count)
        : 0,
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

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

const BENCHMARK_TRANSCRIPT_SEARCH_CONTENT = sessionTranscriptSearchContentSql('session_nodes')
const BENCHMARK_ID_DIGIT_COUNT = 8

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
  input: {
    readonly sessionCount: number
    readonly messageCount: number
    readonly skewedSessionMessageCount: number
  },
) {
  database.exec(`
    INSERT INTO session_title_search (session_id, title)
    SELECT id, title FROM sessions;
    INSERT INTO session_node_search (session_id, node_id, content)
    SELECT session_id, id, ${BENCHMARK_TRANSCRIPT_SEARCH_CONTENT} FROM session_nodes;
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
  const baseOccurrences = Math.floor(input.messageCount / input.sessionCount)
  database
    .prepare(`
      INSERT INTO session_transcript_term_documents (session_id, token_count)
      SELECT id, ? * 4 + CASE WHEN id = 'session-000000' THEN ? * 5 ELSE 0 END
      FROM sessions
    `)
    .run(baseOccurrences, input.skewedSessionMessageCount)
  database
    .prepare(`
      INSERT INTO session_transcript_terms (
        term, session_id, occurrences, first_node_id, first_created_order
      )
      SELECT term, sessions.id,
        ? + CASE
          WHEN sessions.id = 'session-000000' AND term IN ('ordinary', 'message')
            THEN ? - 1
          ELSE 0
        END,
        printf('node-%08d', CAST(substr(sessions.id, 9) AS INTEGER)), 0
      FROM sessions
      CROSS JOIN (
        SELECT 'ordinary' AS term UNION ALL SELECT 'project'
        UNION ALL SELECT 'implementation' UNION ALL SELECT 'message'
      )
    `)
    .run(baseOccurrences, input.skewedSessionMessageCount)
  database
    .prepare(`
      INSERT INTO session_transcript_terms (
        term, session_id, occurrences, first_node_id, first_created_order
      ) VALUES
        ('skewed', 'session-000000', ?, 'skew-node-00000000', ?),
        ('long', 'session-000000', ?, 'skew-node-00000000', ?),
        ('session', 'session-000000', ?, 'skew-node-00000000', ?),
        ('terminal', 'session-000000', 1, ?, ?),
        ('marker', 'session-000000', 1, ?, ?)
    `)
    .run(
      input.skewedSessionMessageCount,
      baseOccurrences,
      input.skewedSessionMessageCount,
      baseOccurrences,
      input.skewedSessionMessageCount,
      baseOccurrences,
      `skew-node-${String(input.skewedSessionMessageCount - 1).padStart(BENCHMARK_ID_DIGIT_COUNT, '0')}`,
      baseOccurrences + input.skewedSessionMessageCount - 1,
      `skew-node-${String(input.skewedSessionMessageCount - 1).padStart(BENCHMARK_ID_DIGIT_COUNT, '0')}`,
      baseOccurrences + input.skewedSessionMessageCount - 1,
    )
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

import { mkdtemp, rm, stat } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import * as SqlClient from '@effect/sql/SqlClient'
import { SqliteClient } from '@effect/sql-sqlite-node'
import { SESSION_QUERY_CONTRACT_VERSION } from '@shared/types/session-query'
import * as Effect from 'effect/Effect'
import * as ManagedRuntime from 'effect/ManagedRuntime'
import { loadLexicalDiscoveryRows } from '../src/main/adapters/sqlite-session-lexical-search'
import { listSessions } from '../src/main/adapters/sqlite-session-query-catalog'
import { readItems } from '../src/main/adapters/sqlite-session-query-items'
import { CURRENT_SESSION_SCHEMA_STATEMENTS } from '../src/main/services/database-schema'
import { SQLITE_PREPARE_CACHE_SIZE } from '../src/main/services/database-constants'
import { SESSION_HOST_TARGET_SCHEMA_STATEMENTS } from '../src/main/services/session-host-target-schema'

const STANDARD_SESSION_COUNT = 100_000
const STANDARD_MESSAGE_COUNT = 10_000_000
const SMOKE_SESSION_COUNT = 1_000
const SMOKE_MESSAGE_COUNT = 100_000
const MEASURED_RUNS = 20
const WARMUP_RUNS = 3
const PAGE_SIZE = 50
const P95 = 0.95
const WARM_P95_LIMIT_MS = 100
const COLD_LIMIT_MS = 500
const JSON_INDENT_SPACES = 2
const BYTES_PER_MEBIBYTE = 1_048_576

function percentile(values: readonly number[], fraction: number) {
  const sorted = values.toSorted((left, right) => left - right)
  const index = Math.max(0, Math.ceil(sorted.length * fraction) - 1)
  return sorted[index] ?? 0
}

function schema(database: DatabaseSync) {
  database.exec('PRAGMA journal_mode = OFF; PRAGMA synchronous = OFF; PRAGMA temp_store = FILE;')
  database.exec('PRAGMA cache_size = -131072;')
  for (const statement of CURRENT_SESSION_SCHEMA_STATEMENTS) database.exec(statement)
  for (const statement of SESSION_HOST_TARGET_SCHEMA_STATEMENTS) database.exec(statement)
}

function populate(database: DatabaseSync, sessionCount: number, messageCount: number) {
  database.exec('BEGIN IMMEDIATE')
  database
    .prepare(`
      WITH RECURSIVE sequence(value) AS (
        SELECT 0 UNION ALL SELECT value + 1 FROM sequence WHERE value + 1 < ?
      )
      INSERT INTO sessions (
        id, pi_session_id, project_path, title, archived, created_at, updated_at
      )
      SELECT printf('session-%06d', value), printf('pi-%06d', value),
        '/benchmark/project', printf('Benchmark session %06d', value), 0,
        value, value FROM sequence
    `)
    .run(sessionCount)
  database.exec('INSERT INTO session_title_search SELECT id, title FROM sessions')
  database
    .prepare(`
      WITH RECURSIVE sequence(value) AS (
        SELECT 0 UNION ALL SELECT value + 1 FROM sequence WHERE value + 1 < ?
      )
      INSERT INTO session_nodes (
        id, session_id, pi_entry_type, kind, role, timestamp_ms, content_json,
        metadata_json, path_depth, created_order
      )
      SELECT printf('node-%08d', value), printf('session-%06d', value % ?),
        'message', 'message',
        CASE WHEN CAST(value / ? AS INTEGER) % 2 = 0 THEN 'user' ELSE 'assistant' END,
        value,
        json_object('text', CASE
          WHEN CAST(value / ? AS INTEGER) = CAST((? - 1) / ? AS INTEGER)
            AND value % 100 = 0
          THEN 'rare benchmarktoken final result'
          ELSE 'ordinary project implementation message'
        END),
        '{}', 0, CAST(value / ? AS INTEGER)
      FROM sequence
    `)
    .run(
      messageCount,
      sessionCount,
      sessionCount,
      sessionCount,
      messageCount,
      sessionCount,
      sessionCount,
    )
  database.exec('INSERT INTO session_node_search SELECT session_id, id, content_json FROM session_nodes')
  database.exec(`
    INSERT INTO session_node_discovery_search
    SELECT nodes.session_id, nodes.id, nodes.content_json
    FROM session_nodes AS nodes
    WHERE nodes.created_order = 0 OR nodes.created_order = (
      SELECT MAX(preview.created_order) FROM session_nodes AS preview
      WHERE preview.session_id = nodes.session_id
    )
  `)
  database.exec('COMMIT; PRAGMA optimize;')
}

async function measure(run: () => Promise<unknown>) {
  const timings: number[] = []
  for (let iteration = 0; iteration < WARMUP_RUNS + MEASURED_RUNS; iteration += 1) {
    const startedAt = performance.now()
    await run()
    const elapsed = performance.now() - startedAt
    if (iteration >= WARMUP_RUNS) timings.push(elapsed)
  }
  return { p95Ms: percentile(timings, P95), timings }
}

function queryExecutor(databasePath: string) {
  const runtime = ManagedRuntime.make(
    SqliteClient.layer({ filename: databasePath, prepareCacheSize: SQLITE_PREPARE_CACHE_SIZE }),
  )
  return {
    run: <A, E>(effect: Effect.Effect<A, E, SqlClient.SqlClient>) => runtime.runPromise(effect),
    dispose: () => runtime.dispose(),
  }
}

async function benchmarkQueries(databasePath: string) {
  const runtime = queryExecutor(databasePath)
  const list = () =>
    runtime.run(
      Effect.flatMap(SqlClient.SqlClient, (sql) =>
        listSessions(sql, undefined, {
          contractVersion: SESSION_QUERY_CONTRACT_VERSION,
          requestId: 'benchmark-list',
          query: { operation: 'list', limit: PAGE_SIZE },
        }),
      ),
    )
  const lexical = () =>
    runtime.run(
      Effect.flatMap(SqlClient.SqlClient, (sql) =>
        loadLexicalDiscoveryRows(sql, undefined, {
          contractVersion: SESSION_QUERY_CONTRACT_VERSION,
          requestId: 'benchmark-lexical',
          query: {
            operation: 'search',
            query: 'benchmarktoken',
            limit: PAGE_SIZE,
            mode: 'lexical',
          },
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
  await list()
  const coldListMs = performance.now() - coldStartedAt
  try {
    return {
      coldListMs,
      list: await measure(list),
      lexical: await measure(lexical),
      transcript: await measure(transcript),
    }
  } finally {
    await runtime.dispose()
  }
}

function counts(database: DatabaseSync) {
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

async function main() {
  const smoke = process.argv.includes('--smoke')
  const sessionCount = smoke ? SMOKE_SESSION_COUNT : STANDARD_SESSION_COUNT
  const messageCount = smoke ? SMOKE_MESSAGE_COUNT : STANDARD_MESSAGE_COUNT
  const root = await mkdtemp(path.join(os.tmpdir(), 'openwaggle-session-benchmark-'))
  const databasePath = path.join(root, 'sessions.sqlite')
  let database = new DatabaseSync(databasePath)
  try {
    schema(database)
    const buildStartedAt = performance.now()
    populate(database, sessionCount, messageCount)
    const buildMs = performance.now() - buildStartedAt
    database.close()
    database = new DatabaseSync(databasePath, { readOnly: true })
    const corpus = counts(database)
    database.close()
    const queries = await benchmarkQueries(databasePath)
    database = new DatabaseSync(databasePath, { readOnly: true })
    const databaseSizeMb = (await stat(databasePath)).size / BYTES_PER_MEBIBYTE
    const passed =
      corpus.sessions === sessionCount &&
      corpus.messages === messageCount &&
      queries.coldListMs < COLD_LIMIT_MS &&
      queries.list.p95Ms < WARM_P95_LIMIT_MS &&
      queries.lexical.p95Ms < WARM_P95_LIMIT_MS &&
      queries.transcript.p95Ms < WARM_P95_LIMIT_MS
    process.stdout.write(
      `${JSON.stringify(
        {
          mode: smoke ? 'smoke' : 'standard',
          corpus,
          buildMs,
          databaseSizeMb,
          queries: {
            coldListMs: queries.coldListMs,
            listP95Ms: queries.list.p95Ms,
            lexicalP95Ms: queries.lexical.p95Ms,
            transcriptP95Ms: queries.transcript.p95Ms,
          },
          limits: { warmP95Ms: WARM_P95_LIMIT_MS, coldMs: COLD_LIMIT_MS },
          passed,
        },
        null,
        JSON_INDENT_SPACES,
      )}\n`,
    )
    if (!passed) process.exitCode = 1
  } finally {
    database.close()
    await rm(root, { recursive: true, force: true })
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`)
  process.exitCode = 1
})

import { mkdtemp, rm, stat } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import * as SqlClient from '@effect/sql/SqlClient'
import { SESSION_QUERY_CONTRACT_VERSION } from '@shared/types/session-query'
import * as Effect from 'effect/Effect'
import { loadLexicalDiscoveryRows } from '../src/main/adapters/sqlite-session-lexical-search'
import { listSessions } from '../src/main/adapters/sqlite-session-query-catalog'
import { readItems } from '../src/main/adapters/sqlite-session-query-items'
import {
  benchmarkPercentile,
  initializeSessionDiscoveryBenchmarkSchema,
  initializeSessionDiscoveryBenchmarkTargetSchema,
  populateSessionDiscoveryBenchmarkSearchIndexes,
  sessionDiscoveryBenchmarkCounts,
  sessionDiscoveryBenchmarkQueryExecutor,
} from './benchmark-session-discovery-support'

const STANDARD_SESSION_COUNT = 100_000
const STANDARD_MESSAGE_COUNT = 10_000_000
const STANDARD_SKEWED_SESSION_MESSAGE_COUNT = 10_000
const SMOKE_SESSION_COUNT = 1_000
const SMOKE_MESSAGE_COUNT = 100_000
const SMOKE_SKEWED_SESSION_MESSAGE_COUNT = 1_000
const QUERY_SCALE_MESSAGE_COUNT = STANDARD_SESSION_COUNT
const QUERY_SCALE_SKEWED_SESSION_MESSAGE_COUNT = 1_000
const MEASURED_RUNS = 20
const WARMUP_RUNS = 3
const PAGE_SIZE = 50
const P95 = 0.95
const WARM_P95_LIMIT_MS = 100
const COLD_LIMIT_MS = 500
const JSON_INDENT_SPACES = 2
const BYTES_PER_MEBIBYTE = 1_048_576

function populate(
  database: DatabaseSync,
  sessionCount: number,
  messageCount: number,
  skewedSessionMessageCount: number,
) {
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
  database
    .prepare(`
      WITH RECURSIVE sequence(value) AS (
        SELECT 0 UNION ALL SELECT value + 1 FROM sequence WHERE value + 1 < ?
      )
      INSERT INTO session_nodes (
        id, session_id, parent_id, pi_entry_type, kind, role, timestamp_ms, content_json,
        metadata_json, branch_hint_id, path_depth, created_order
      )
      SELECT printf('node-%08d', value), printf('session-%06d', value % ?),
        CASE WHEN value < ? THEN NULL ELSE printf('node-%08d', value - ?) END,
        'message', 'message',
        CASE WHEN CAST(value / ? AS INTEGER) % 2 = 0 THEN 'user' ELSE 'assistant' END,
        value,
        json_object('text', CASE
          WHEN CAST(value / ? AS INTEGER) = CAST((? - 1) / ? AS INTEGER)
            AND value % 100 = 0
          THEN 'rare benchmarktoken final result'
          ELSE 'ordinary project implementation message'
        END),
        '{}', printf('session-%06d:main', value % ?),
        CAST(value / ? AS INTEGER), CAST(value / ? AS INTEGER)
      FROM sequence
    `)
    .run(
      messageCount,
      sessionCount,
      sessionCount,
      sessionCount,
      sessionCount,
      sessionCount,
      messageCount,
      sessionCount,
      sessionCount,
      sessionCount,
      sessionCount,
    )
  database
    .prepare(`
      WITH RECURSIVE sequence(value) AS (
        SELECT 0 UNION ALL SELECT value + 1 FROM sequence WHERE value + 1 < ?
      )
      INSERT INTO session_nodes (
        id, session_id, parent_id, pi_entry_type, kind, role, timestamp_ms, content_json,
        metadata_json, branch_hint_id, path_depth, created_order
      )
      SELECT printf('skew-node-%08d', value), 'session-000000', NULL,
        'message', 'message', 'assistant', ? + value,
        json_object('text', CASE WHEN value = ? - 1
          THEN 'skewed long session terminal marker'
          ELSE 'skewed long session ordinary message'
        END), '{}', NULL, ? + value, ? + value
      FROM sequence
    `)
    .run(
      skewedSessionMessageCount,
      messageCount,
      skewedSessionMessageCount,
      Math.ceil(messageCount / sessionCount),
      Math.ceil(messageCount / sessionCount),
    )
  database
    .prepare(`
      INSERT INTO session_branches (
        id, session_id, source_node_id, head_node_id, name, is_main,
        created_at, updated_at
      )
      SELECT id || ':main', id, NULL,
        printf('node-%08d', ? - ? + CAST(substr(id, 9) AS INTEGER)),
        'Main', 1, created_at, updated_at
      FROM sessions
    `)
    .run(messageCount, sessionCount)
  database
    .prepare(`
      UPDATE sessions SET
        last_active_branch_id = id || ':main',
        last_active_node_id = printf(
          'node-%08d', ? - ? + CAST(substr(id, 9) AS INTEGER)
        )
    `)
    .run(messageCount, sessionCount)
  initializeSessionDiscoveryBenchmarkTargetSchema(database)
  populateSessionDiscoveryBenchmarkSearchIndexes(database, {
    sessionCount,
    messageCount,
    skewedSessionMessageCount,
  })
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
  return { p95Ms: benchmarkPercentile(timings, P95), timings }
}

async function benchmarkQueries(databasePath: string) {
  const runtime = sessionDiscoveryBenchmarkQueryExecutor(databasePath)
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
  const fullTranscript = () =>
    runtime.run(
      Effect.flatMap(SqlClient.SqlClient, (sql) =>
        loadLexicalDiscoveryRows(sql, undefined, {
          contractVersion: SESSION_QUERY_CONTRACT_VERSION,
          requestId: 'benchmark-full-transcript',
          query: {
            operation: 'search',
            query: 'ordinary',
            limit: PAGE_SIZE,
            mode: 'lexical',
            searchScope: 'full-transcript',
          },
        }),
      ),
    )
  const transcript = async () => {
    const response = await runtime.run(
      Effect.flatMap(SqlClient.SqlClient, (sql) =>
        readItems(sql, {
          contractVersion: SESSION_QUERY_CONTRACT_VERSION,
          requestId: 'benchmark-transcript',
          query: { operation: 'items', sessionId: 'session-000000', limit: PAGE_SIZE },
        }),
      ),
    )
    if (
      response.outcome.operation !== 'items' ||
      !('items' in response.outcome) ||
      response.outcome.items.length === 0
    ) {
      throw new Error('Transcript benchmark did not read a production-shaped active branch page.')
    }
    return response
  }
  const coldStartedAt = performance.now()
  await list()
  const coldListMs = performance.now() - coldStartedAt
  try {
    return {
      coldListMs,
      list: await measure(list),
      lexical: await measure(lexical),
      fullTranscript: await measure(fullTranscript),
      transcript: await measure(transcript),
    }
  } finally {
    await runtime.dispose()
  }
}

async function main() {
  const smoke = process.argv.includes('--smoke')
  const queryScale = process.argv.includes('--query-scale')
  const sessionCount = smoke ? SMOKE_SESSION_COUNT : STANDARD_SESSION_COUNT
  const messageCount = smoke
    ? SMOKE_MESSAGE_COUNT
    : queryScale
      ? QUERY_SCALE_MESSAGE_COUNT
      : STANDARD_MESSAGE_COUNT
  const skewedSessionMessageCount = smoke
    ? SMOKE_SKEWED_SESSION_MESSAGE_COUNT
    : queryScale
      ? QUERY_SCALE_SKEWED_SESSION_MESSAGE_COUNT
      : STANDARD_SKEWED_SESSION_MESSAGE_COUNT
  const root = await mkdtemp(path.join(os.tmpdir(), 'openwaggle-session-benchmark-'))
  const databasePath = path.join(root, 'sessions.sqlite')
  let database = new DatabaseSync(databasePath)
  try {
    initializeSessionDiscoveryBenchmarkSchema(database)
    const buildStartedAt = performance.now()
    populate(database, sessionCount, messageCount, skewedSessionMessageCount)
    const buildMs = performance.now() - buildStartedAt
    database.close()
    database = new DatabaseSync(databasePath, { readOnly: true })
    const corpus = sessionDiscoveryBenchmarkCounts(database)
    database.close()
    const queries = await benchmarkQueries(databasePath)
    database = new DatabaseSync(databasePath, { readOnly: true })
    const databaseSizeMb = (await stat(databasePath)).size / BYTES_PER_MEBIBYTE
    const passed =
      corpus.sessions === sessionCount &&
      corpus.messages === messageCount + skewedSessionMessageCount &&
      queries.coldListMs < COLD_LIMIT_MS &&
      queries.list.p95Ms < WARM_P95_LIMIT_MS &&
      queries.lexical.p95Ms < WARM_P95_LIMIT_MS &&
      queries.fullTranscript.p95Ms < WARM_P95_LIMIT_MS &&
      queries.transcript.p95Ms < WARM_P95_LIMIT_MS
    process.stdout.write(
      `${JSON.stringify(
        {
          mode: smoke ? 'smoke' : queryScale ? 'query-scale' : 'standard',
          corpus,
          skewedSessionMessageCount,
          buildMs,
          databaseSizeMb,
          queries: {
            coldListMs: queries.coldListMs,
            listP95Ms: queries.list.p95Ms,
            lexicalP95Ms: queries.lexical.p95Ms,
            fullTranscriptP95Ms: queries.fullTranscript.p95Ms,
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

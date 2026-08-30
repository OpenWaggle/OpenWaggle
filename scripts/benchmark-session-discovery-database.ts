import { mkdtemp, rm, stat } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'

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
  database.exec(`
    PRAGMA journal_mode = OFF;
    PRAGMA synchronous = OFF;
    PRAGMA temp_store = FILE;
    PRAGMA cache_size = -131072;
    CREATE TABLE sessions (
      id TEXT PRIMARY KEY, pi_session_id TEXT NOT NULL UNIQUE, project_path TEXT,
      title TEXT NOT NULL, archived INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    );
    CREATE INDEX idx_sessions_updated ON sessions(updated_at DESC, id DESC);
    CREATE TABLE session_nodes (
      id TEXT PRIMARY KEY, session_id TEXT NOT NULL, kind TEXT NOT NULL, role TEXT,
      timestamp_ms INTEGER NOT NULL, content_json TEXT NOT NULL,
      metadata_json TEXT NOT NULL, created_order INTEGER NOT NULL
    );
    CREATE UNIQUE INDEX idx_nodes_session_order ON session_nodes(session_id, created_order);
    CREATE TABLE session_spawn_lineage (
      child_session_id TEXT PRIMARY KEY, parent_session_id TEXT NOT NULL,
      hive_root_session_id TEXT NOT NULL
    );
    CREATE INDEX idx_lineage_parent ON session_spawn_lineage(parent_session_id, child_session_id);
    CREATE TABLE session_execution_profiles (session_id TEXT PRIMARY KEY, profile_json TEXT);
    CREATE TABLE delegation_contracts (
      id TEXT PRIMARY KEY, child_session_id TEXT UNIQUE, state TEXT
    );
    CREATE VIRTUAL TABLE session_title_search USING fts5(
      session_id UNINDEXED, title, tokenize = 'unicode61 remove_diacritics 2'
    );
    CREATE VIRTUAL TABLE session_node_search USING fts5(
      session_id UNINDEXED, node_id UNINDEXED, content,
      tokenize = 'unicode61 remove_diacritics 2'
    );
  `)
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
        id, session_id, kind, role, timestamp_ms, content_json, metadata_json, created_order
      )
      SELECT printf('node-%08d', value), printf('session-%06d', value % ?),
        'message', CASE WHEN CAST(value / ? AS INTEGER) % 2 = 0 THEN 'user' ELSE 'assistant' END,
        value,
        json_object('text', CASE
          WHEN CAST(value / ? AS INTEGER) = CAST((? - 1) / ? AS INTEGER)
            AND value % 100 = 0
          THEN 'rare benchmarktoken final result'
          ELSE 'ordinary project implementation message'
        END),
        '{}', CAST(value / ? AS INTEGER)
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
  database.exec('COMMIT; PRAGMA optimize;')
}

function measure(statement: ReturnType<DatabaseSync['prepare']>) {
  const timings: number[] = []
  for (let run = 0; run < WARMUP_RUNS + MEASURED_RUNS; run += 1) {
    const startedAt = performance.now()
    statement.all()
    const elapsed = performance.now() - startedAt
    if (run >= WARMUP_RUNS) timings.push(elapsed)
  }
  return { p95Ms: percentile(timings, P95), timings }
}

function benchmarkQueries(database: DatabaseSync) {
  const list = database.prepare(`
    SELECT sessions.id, sessions.title, sessions.updated_at,
      (SELECT COUNT(*) FROM session_spawn_lineage AS lineage
        WHERE lineage.parent_session_id = sessions.id) AS direct_worker_count
    FROM sessions
    ORDER BY sessions.updated_at DESC, sessions.id DESC LIMIT ${PAGE_SIZE + 1}
  `)
  const lexical = database.prepare(`
    WITH matches AS (
      SELECT session_node_search.session_id, bm25(session_node_search) AS score
      FROM session_node_search
      JOIN session_nodes ON session_nodes.id = session_node_search.node_id
      WHERE session_node_search MATCH 'benchmarktoken'
        AND session_nodes.id = (
          SELECT preview.id FROM session_nodes AS preview
          WHERE preview.session_id = session_nodes.session_id
            AND preview.role IN ('user', 'assistant')
          ORDER BY preview.created_order DESC, preview.id DESC LIMIT 1
        )
      ORDER BY score LIMIT 1001
    )
    SELECT sessions.id, sessions.title, matches.score
    FROM matches JOIN sessions ON sessions.id = matches.session_id
    ORDER BY matches.score, sessions.id LIMIT 1001
  `)
  const transcript = database.prepare(`
    SELECT id, role, content_json, metadata_json, created_order
    FROM session_nodes WHERE session_id = 'session-000000'
    ORDER BY created_order LIMIT ${PAGE_SIZE + 1}
  `)
  const coldStartedAt = performance.now()
  list.all()
  const coldListMs = performance.now() - coldStartedAt
  return {
    coldListMs,
    list: measure(list),
    lexical: measure(lexical),
    transcript: measure(transcript),
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
    const queries = benchmarkQueries(database)
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

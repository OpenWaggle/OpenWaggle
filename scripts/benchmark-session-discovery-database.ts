import { mkdtemp, rm, stat } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { SessionEmbeddingModel } from '../src/main/adapters/multilingual-e5-session-embedding-model'
import { SESSION_TRANSCRIPT_SEMANTIC_STORAGE_POLICY } from '../src/main/domain/session-transcript-semantic-storage-policy'
import { runSessionHostCutover } from '../src/main/session-host/session-host-cutover'
import {
  benchmarkSessionDiscoveryBackfills,
  benchmarkSessionDiscoveryQueries,
  initializeSessionDiscoveryBenchmarkSource,
  sessionDiscoveryBenchmarkCounts,
} from './benchmark-session-discovery-support'
import { sessionDiscoveryBenchmarkMode } from './benchmark-session-discovery-mode'

const UPDATED_AT_BUCKET_COUNT = 100
const PROJECT_ID_WIDTH = 4
const WARM_P95_LIMIT_MS = 100
const COLD_LIMIT_MS = 500
const JSON_INDENT_SPACES = 2
const BYTES_PER_MEBIBYTE = 1_048_576
const BENCHMARK_MODEL_DIMENSIONS = 3
const BENCHMARK_NOW = 1_000

const benchmarkModel: SessionEmbeddingModel = {
  metadata: {
    id: 'benchmark/embedding',
    revision: 'benchmark-1',
    dimensions: BENCHMARK_MODEL_DIMENSIONS,
    dtype: 'f32',
  },
  embedQueries: async (texts) => texts.map(() => new Float32Array([1, 0, 0])),
  embedPassages: async (texts) => texts.map(() => new Float32Array([1, 0, 0])),
}

interface BenchmarkInput {
  readonly sessionCount: number
  readonly messageCount: number
  readonly skewedSessionMessageCount: number
  readonly projectCount: number
}

function projectPath(projectIndex: number) {
  return `/benchmark/project-${String(projectIndex).padStart(PROJECT_ID_WIDTH, '0')}`
}

function populate(database: DatabaseSync, input: BenchmarkInput) {
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
        printf('/benchmark/project-%04d', value % ?),
        printf('Benchmark session %06d', value), 0,
        value, value % ? FROM sequence
    `)
    .run(input.sessionCount, input.projectCount, UPDATED_AT_BUCKET_COUNT)
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
      input.messageCount,
      input.sessionCount,
      input.sessionCount,
      input.sessionCount,
      input.sessionCount,
      input.sessionCount,
      input.messageCount,
      input.sessionCount,
      input.sessionCount,
      input.sessionCount,
      input.sessionCount,
    )
  const baseMessageCount = Math.ceil(input.messageCount / input.sessionCount)
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
          ELSE 'ordinary project implementation message'
        END), '{}', NULL, ? + value, ? + value
      FROM sequence
    `)
    .run(
      input.skewedSessionMessageCount,
      input.messageCount,
      input.skewedSessionMessageCount,
      baseMessageCount,
      baseMessageCount,
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
    .run(input.messageCount, input.sessionCount)
  database
    .prepare(`
      UPDATE sessions SET
        last_active_branch_id = id || ':main',
        last_active_node_id = printf(
          'node-%08d', ? - ? + CAST(substr(id, 9) AS INTEGER)
        )
    `)
    .run(input.messageCount, input.sessionCount)
  database.exec('COMMIT; PRAGMA optimize;')
}

async function main() {
  const mode = sessionDiscoveryBenchmarkMode(process.argv)
  const root = await mkdtemp(path.join(os.tmpdir(), 'openwaggle-session-benchmark-'))
  const sourceDatabasePath = path.join(root, 'openwaggle.db')
  const targetDatabasePath = path.join(root, 'session-host', 'session-host.sqlite')
  const recoveryDatabasePath = path.join(root, 'openwaggle.pre-session-host-v2.db')
  try {
    const source = new DatabaseSync(sourceDatabasePath)
    const seedStartedAt = performance.now()
    try {
      initializeSessionDiscoveryBenchmarkSource(source)
      populate(source, mode)
    } finally {
      source.close()
    }
    const seedMs = performance.now() - seedStartedAt
    const cutoverStartedAt = performance.now()
    const cutover = await runSessionHostCutover(
      { sourceDatabasePath, targetDatabasePath, recoveryDatabasePath },
      BENCHMARK_NOW,
      benchmarkModel,
    )
    const cutoverMs = performance.now() - cutoverStartedAt
    if (cutover.status !== 'migrated') throw new Error('Benchmark cutover did not migrate the source.')

    const backfills = await benchmarkSessionDiscoveryBackfills(targetDatabasePath, benchmarkModel)
    const target = new DatabaseSync(targetDatabasePath, { readOnly: true })
    const corpus = sessionDiscoveryBenchmarkCounts(target)
    target.close()
    const sparseWorkingPath = projectPath(mode.projectCount - 1)
    const queries = await benchmarkSessionDiscoveryQueries(targetDatabasePath, sparseWorkingPath)
    const databaseSizeMb = (await stat(targetDatabasePath)).size / BYTES_PER_MEBIBYTE
    const expectedTranscriptEmbeddings = Math.min(
      Math.ceil(mode.messageCount / mode.sessionCount) + mode.skewedSessionMessageCount,
      SESSION_TRANSCRIPT_SEMANTIC_STORAGE_POLICY.perSessionNodeLimit,
    )
    const passed = [
      corpus.sessions === mode.sessionCount &&
        corpus.messages === mode.messageCount + mode.skewedSessionMessageCount,
      cutoverMs < mode.cutoverLimitMs &&
        backfills.discovery.elapsedMs < mode.discoveryBackfillLimitMs,
      backfills.discovery.prepared === mode.sessionCount,
      backfills.transcript.elapsedMs < mode.transcriptBackfillLimitMs &&
        backfills.transcript.counts.embeddings === expectedTranscriptEmbeddings,
      backfills.transcript.counts.eligible === expectedTranscriptEmbeddings,
      backfills.transcript.counts.pending === 0,
      queries.coldWorkingPathListMs < COLD_LIMIT_MS &&
        queries.list.p95Ms < WARM_P95_LIMIT_MS,
      queries.sparseWorkingPathList.p95Ms < WARM_P95_LIMIT_MS,
      queries.missingWorkingPathList.p95Ms < WARM_P95_LIMIT_MS,
      queries.lexical.p95Ms < WARM_P95_LIMIT_MS,
      queries.transcript.p95Ms < WARM_P95_LIMIT_MS,
    ].every(Boolean)
    process.stdout.write(
      `${JSON.stringify(
        {
          mode: mode.name,
          corpus,
          projectCount: mode.projectCount,
          tiedUpdatedAtBuckets: UPDATED_AT_BUCKET_COUNT,
          skewedSessionMessageCount: mode.skewedSessionMessageCount,
          seedMs,
          cutoverMs,
          backfills,
          databaseSizeMb,
          queries: {
            coldWorkingPathListMs: queries.coldWorkingPathListMs,
            listP95Ms: queries.list.p95Ms,
            sparseWorkingPathListP95Ms: queries.sparseWorkingPathList.p95Ms,
            missingWorkingPathListP95Ms: queries.missingWorkingPathList.p95Ms,
            lexicalP95Ms: queries.lexical.p95Ms,
            transcriptP95Ms: queries.transcript.p95Ms,
          },
          limits: {
            cutoverMs: mode.cutoverLimitMs,
            discoveryBackfillMs: mode.discoveryBackfillLimitMs,
            transcriptBackfillMs: mode.transcriptBackfillLimitMs,
            warmP95Ms: WARM_P95_LIMIT_MS,
            coldMs: COLD_LIMIT_MS,
          },
          passed,
        },
        null,
        JSON_INDENT_SPACES,
      )}\n`,
    )
    if (!passed) process.exitCode = 1
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`)
  process.exitCode = 1
})

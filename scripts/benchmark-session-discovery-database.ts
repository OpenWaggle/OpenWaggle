import { mkdtemp, rm, stat } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { SESSION_SEMANTIC_DISCOVERY_STORAGE_POLICY } from '../src/main/domain/session-semantic-discovery-storage-policy'
import { runSessionHostCutover } from '../src/main/session-host/session-host-cutover'
import { sessionDiscoveryBenchmarkPassed } from './benchmark-session-discovery-assertions'
import { benchmarkSessionDiscoveryModel } from './benchmark-session-discovery-model'
import {
  benchmarkCommonTermIncrementalProjection,
  benchmarkSessionDiscoveryBackfills,
  benchmarkSessionDiscoveryQueries,
  initializeSessionDiscoveryBenchmarkSource,
  reportSessionDiscoveryBenchmarkPhase,
  sessionDiscoveryBenchmarkCounts,
} from './benchmark-session-discovery-support'
import { sessionDiscoveryBenchmarkMode } from './benchmark-session-discovery-mode'
import { reportSessionDiscoveryBenchmarkResult } from './benchmark-session-discovery-result'

const UPDATED_AT_BUCKET_COUNT = 100
const PROJECT_ID_WIDTH = 4
const WARM_P95_LIMIT_MS = 100
const HYBRID_P95_LIMIT_MS = 250
const PHRASE_P95_LIMIT_MS = 250
const COLD_LIMIT_MS = 500
const COMMON_TERM_INCREMENTAL_LIMIT_MS = 1_000
const BYTES_PER_MEBIBYTE = 1_048_576
const BENCHMARK_NOW = 1_000
function populateSkewedMessages(
  database: DatabaseSync,
  input: ReturnType<typeof sessionDiscoveryBenchmarkMode>,
  baseMessageCount: number,
) {
  database
    .prepare(`
      WITH RECURSIVE sequence(value) AS (
        SELECT 0 UNION ALL SELECT value + 1 FROM sequence WHERE value + 1 < ?
      )
      INSERT INTO session_nodes (
        id, session_id, parent_id, pi_entry_type, kind, role, timestamp_ms, content_json,
        metadata_json, branch_hint_id, path_depth, created_order
      )
      SELECT printf('skew-node-%08d', value), 'session-000000',
        CASE WHEN value = 0 THEN printf('node-%08d', ? - ?)
          ELSE printf('skew-node-%08d', value - 1) END,
        'message', 'message', CASE WHEN value % 5 = 0 THEN 'user' ELSE 'assistant' END, ? + value,
        json_object('parts', json_array(
          json_object('type', 'text', 'text', CASE WHEN value = ? - 1
            THEN printf('commonterm skewed long session terminal marker-%08d', value)
            ELSE printf(
              'commonterm continue long branch step-%08d in module-%05d with observed output',
              value, value % 10000
            )
          END),
          json_object('type', 'tool-result', 'toolResult',
            json_object('name', printf('long_branch_check_%03d', value % 983)))
        )), '{}', 'session-000000:main', ? + value, ? + value
      FROM sequence
    `)
    .run(
      input.skewedSessionMessageCount,
      input.messageCount,
      input.sessionCount,
      input.messageCount,
      input.skewedSessionMessageCount,
      baseMessageCount,
      baseMessageCount,
    )
}

function populate(database: DatabaseSync, input: ReturnType<typeof sessionDiscoveryBenchmarkMode>) {
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
        json_object('parts', json_array(
          json_object('type', 'text', 'text', CASE
            WHEN value > 0
              AND CAST(value / ? AS INTEGER) = CAST((? - 1) / ? AS INTEGER)
              AND value % 100 = 0
            THEN printf('rare benchmarktoken final result for artifact-%08d', value)
            ELSE printf(
              'commonterm implement project-%04d module-%05d request-%08d with validation tests',
              value % 1000, value % 10000, value
            )
          END),
          CASE value % 3
            WHEN 0 THEN json_object('type', 'attachment', 'attachment',
              json_object('name', printf('design-%05d.md', value % 10000)))
            WHEN 1 THEN json_object('type', 'tool-call', 'toolCall',
              json_object('name', printf('inspect_module_%03d', value % 997)))
            ELSE json_object('type', 'tool-result', 'toolResult',
              json_object('name', printf('verify_module_%03d', value % 991)))
          END
        )),
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
  populateSkewedMessages(database, input, baseMessageCount)
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
  database
    .prepare(`
      UPDATE session_branches SET
        head_node_id = printf('skew-node-%08d', ? - 1), updated_at = ?
      WHERE id = 'session-000000:main'
    `)
    .run(input.skewedSessionMessageCount, input.messageCount + input.skewedSessionMessageCount)
  database
    .prepare(`
      UPDATE sessions SET
        last_active_node_id = printf('skew-node-%08d', ? - 1),
        updated_at = ?
      WHERE id = 'session-000000'
    `)
    .run(input.skewedSessionMessageCount, input.messageCount + input.skewedSessionMessageCount)
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
    reportSessionDiscoveryBenchmarkPhase('seed', seedMs)
    const cutoverStartedAt = performance.now()
    const cutover = await runSessionHostCutover(
      { sourceDatabasePath, targetDatabasePath, recoveryDatabasePath },
      BENCHMARK_NOW,
      benchmarkSessionDiscoveryModel,
    )
    const cutoverMs = performance.now() - cutoverStartedAt
    reportSessionDiscoveryBenchmarkPhase('cutover', cutoverMs)
    if (cutover.status !== 'migrated') throw new Error('Benchmark cutover did not migrate the source.')

    const commonTermIncremental = await benchmarkCommonTermIncrementalProjection(targetDatabasePath)
    reportSessionDiscoveryBenchmarkPhase('common-term projection', commonTermIncremental.elapsedMs)
    const backfills = await benchmarkSessionDiscoveryBackfills(targetDatabasePath, benchmarkSessionDiscoveryModel)
    reportSessionDiscoveryBenchmarkPhase('discovery backfill', backfills.discovery.elapsedMs)
    reportSessionDiscoveryBenchmarkPhase('transcript backfill', backfills.transcript.elapsedMs)
    const target = new DatabaseSync(targetDatabasePath, { readOnly: true })
    const corpus = sessionDiscoveryBenchmarkCounts(target)
    target.close()
    const lastProject = String(mode.projectCount - 1).padStart(PROJECT_ID_WIDTH, '0')
    const sparseWorkingPath = `/benchmark/project-${lastProject}`
    const queriesStartedAt = performance.now()
    const queries = await benchmarkSessionDiscoveryQueries(
      targetDatabasePath,
      sparseWorkingPath,
      benchmarkSessionDiscoveryModel,
    )
    reportSessionDiscoveryBenchmarkPhase('queries', performance.now() - queriesStartedAt)
    const databaseSizeMb = (await stat(targetDatabasePath)).size / BYTES_PER_MEBIBYTE
    const passed = sessionDiscoveryBenchmarkPassed({
      mode,
      corpus,
      databaseSizeMb,
      cutoverMs,
      backfills,
      commonTermIncremental,
      queries,
      limits: {
        coldMs: COLD_LIMIT_MS,
        commonTermIncrementalMs: COMMON_TERM_INCREMENTAL_LIMIT_MS,
        hybridP95Ms: HYBRID_P95_LIMIT_MS,
        phraseP95Ms: PHRASE_P95_LIMIT_MS,
        warmP95Ms: WARM_P95_LIMIT_MS,
      },
    })
    reportSessionDiscoveryBenchmarkResult(
      {
        mode: mode.name,
        corpus,
        projectCount: mode.projectCount,
        tiedUpdatedAtBuckets: UPDATED_AT_BUCKET_COUNT,
        skewedSessionMessageCount: mode.skewedSessionMessageCount,
        seedMs,
        cutoverMs,
        commonTermIncremental,
        backfills,
        databaseSizeMb,
        queries: {
          coldWorkingPathListMs: queries.coldWorkingPathListMs,
          listP95Ms: queries.list.p95Ms,
          sparseWorkingPathListP95Ms: queries.sparseWorkingPathList.p95Ms,
          missingWorkingPathListP95Ms: queries.missingWorkingPathList.p95Ms,
          lexicalP95Ms: queries.lexical.p95Ms,
          commonLexicalP95Ms: queries.commonLexical.p95Ms,
          fullTranscriptLexicalP95Ms: queries.fullTranscriptLexical.p95Ms,
          commonFullTranscriptLexicalP95Ms: queries.commonFullTranscriptLexical.p95Ms,
          phraseFullTranscriptLexicalP95Ms: queries.phraseFullTranscriptLexical.p95Ms,
          hybridP95Ms: queries.hybrid.p95Ms,
          transcriptP95Ms: queries.transcript.p95Ms,
        },
        limits: {
          cutoverMs: mode.cutoverLimitMs,
          discoveryBackfillMs: mode.discoveryBackfillLimitMs,
          transcriptBackfillMs: mode.transcriptBackfillLimitMs,
          semanticDiscoveryRecords: SESSION_SEMANTIC_DISCOVERY_STORAGE_POLICY.recordLimit,
          databaseSizeMb: mode.databaseSizeLimitMb,
          commonTermIncrementalMs: COMMON_TERM_INCREMENTAL_LIMIT_MS,
          warmP95Ms: WARM_P95_LIMIT_MS,
          hybridP95Ms: HYBRID_P95_LIMIT_MS,
          phraseP95Ms: PHRASE_P95_LIMIT_MS,
          coldMs: COLD_LIMIT_MS,
        },
        passed,
      },
      passed,
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`)
  process.exitCode = 1
})

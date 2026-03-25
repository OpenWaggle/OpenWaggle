import { mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import * as SqlClient from '@effect/sql/SqlClient'
import { SqliteClient } from '@effect/sql-sqlite-node'
import { Context, Effect, Layer } from 'effect'
import { app } from 'electron'
import { DatabaseBootstrapError } from '../errors'

const DATABASE_FILE_NAME = 'openwaggle.db'
const SQLITE_PREPARE_CACHE_SIZE = 128

interface AppMigration {
  readonly id: number
  readonly name: string
  readonly statements: readonly string[]
}

const APP_MIGRATIONS: readonly AppMigration[] = [
  {
    id: 1,
    name: 'initial-app-persistence',
    statements: [
      `
      CREATE TABLE IF NOT EXISTS settings_store (
        key TEXT PRIMARY KEY,
        value_json TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      )
      `,
      `
      CREATE TABLE IF NOT EXISTS auth_tokens (
        provider TEXT PRIMARY KEY,
        encrypted_value TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      )
      `,
      `
      CREATE TABLE IF NOT EXISTS team_presets (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT NOT NULL,
        config_json TEXT NOT NULL,
        is_built_in INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
      `,
      `
      CREATE TABLE IF NOT EXISTS conversations (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        model TEXT,
        project_path TEXT,
        archived INTEGER NOT NULL DEFAULT 0,
        waggle_config_json TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
      `,
      `
      CREATE INDEX IF NOT EXISTS idx_conversations_updated_at
      ON conversations (updated_at DESC)
      `,
      `
      CREATE TABLE IF NOT EXISTS conversation_messages (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        role TEXT NOT NULL,
        model TEXT,
        metadata_json TEXT,
        created_at INTEGER NOT NULL,
        position INTEGER NOT NULL
      )
      `,
      `
      CREATE UNIQUE INDEX IF NOT EXISTS idx_conversation_messages_position
      ON conversation_messages (conversation_id, position)
      `,
      `
      CREATE TABLE IF NOT EXISTS conversation_message_parts (
        id TEXT PRIMARY KEY,
        message_id TEXT NOT NULL REFERENCES conversation_messages(id) ON DELETE CASCADE,
        part_type TEXT NOT NULL,
        content_json TEXT NOT NULL,
        position INTEGER NOT NULL
      )
      `,
      `
      CREATE UNIQUE INDEX IF NOT EXISTS idx_conversation_message_parts_position
      ON conversation_message_parts (message_id, position)
      `,
      `
      CREATE TABLE IF NOT EXISTS orchestration_events (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT,
        event_id TEXT NOT NULL UNIQUE,
        aggregate_kind TEXT NOT NULL,
        stream_id TEXT NOT NULL,
        stream_version INTEGER NOT NULL,
        event_type TEXT NOT NULL,
        occurred_at TEXT NOT NULL,
        command_id TEXT,
        causation_event_id TEXT,
        correlation_id TEXT,
        actor_kind TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        metadata_json TEXT NOT NULL
      )
      `,
      `
      CREATE INDEX IF NOT EXISTS idx_orchestration_events_sequence
      ON orchestration_events (sequence)
      `,
      `
      CREATE TABLE IF NOT EXISTS provider_session_runtime (
        thread_id TEXT PRIMARY KEY,
        provider_name TEXT NOT NULL,
        adapter_key TEXT NOT NULL,
        runtime_mode TEXT NOT NULL,
        status TEXT NOT NULL,
        last_seen_at TEXT NOT NULL,
        resume_cursor_json TEXT,
        runtime_payload_json TEXT
      )
      `,
      `
      CREATE TABLE IF NOT EXISTS team_runtime_state (
        project_path TEXT NOT NULL,
        team_name TEXT NOT NULL,
        team_config_json TEXT,
        tasks_json TEXT,
        pending_messages_json TEXT,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (project_path, team_name)
      )
      `,
    ],
  },
  {
    id: 2,
    name: 'orchestration-read-models',
    statements: [
      `
      CREATE TABLE IF NOT EXISTS orchestration_runs (
        run_id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL,
        status TEXT NOT NULL,
        started_at TEXT NOT NULL,
        finished_at TEXT,
        max_parallel_tasks INTEGER,
        task_order_json TEXT NOT NULL,
        outputs_json TEXT NOT NULL,
        fallback_used INTEGER NOT NULL DEFAULT 0,
        fallback_reason TEXT,
        updated_at INTEGER NOT NULL
      )
      `,
      `
      CREATE INDEX IF NOT EXISTS idx_orchestration_runs_conversation_updated_at
      ON orchestration_runs (conversation_id, updated_at DESC)
      `,
      `
      CREATE TABLE IF NOT EXISTS orchestration_run_tasks (
        run_id TEXT NOT NULL REFERENCES orchestration_runs(run_id) ON DELETE CASCADE,
        task_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        status TEXT NOT NULL,
        depends_on_json TEXT NOT NULL,
        title TEXT,
        input_json TEXT,
        output_json TEXT,
        started_at TEXT,
        finished_at TEXT,
        error_code TEXT,
        error TEXT,
        retry_json TEXT,
        attempts_json TEXT,
        timeout_ms INTEGER,
        metadata_json TEXT,
        created_order INTEGER NOT NULL,
        PRIMARY KEY (run_id, task_id)
      )
      `,
      `
      CREATE INDEX IF NOT EXISTS idx_orchestration_run_tasks_created_order
      ON orchestration_run_tasks (run_id, created_order ASC)
      `,
    ],
  },
  {
    id: 3,
    name: 'plan-mode-per-conversation',
    statements: [
      `ALTER TABLE conversations ADD COLUMN plan_mode_active INTEGER NOT NULL DEFAULT 0`,
    ],
  },
]

export interface AppDatabaseService {
  readonly path: string
}

export class AppDatabase extends Context.Tag('@openwaggle/AppDatabase')<
  AppDatabase,
  AppDatabaseService
>() {}

function getDatabasePath(): string {
  return join(app.getPath('userData'), DATABASE_FILE_NAME)
}

const createMigrationsTable = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  yield* sql.unsafe(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    )
  `)
})

const runMigrations = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  yield* createMigrationsTable

  for (const migration of APP_MIGRATIONS) {
    const existingRows = yield* sql<{ id: number }>`
      SELECT id
      FROM _migrations
      WHERE id = ${migration.id}
      LIMIT 1
    `

    if (existingRows.length > 0) {
      continue
    }

    yield* sql.withTransaction(
      Effect.gen(function* () {
        for (const statement of migration.statements) {
          yield* sql.unsafe(statement)
        }
        yield* sql`
          INSERT INTO _migrations (id, name, applied_at)
          VALUES (${migration.id}, ${migration.name}, ${new Date().toISOString()})
        `
      }),
    )
  }
})

const makeDatabaseLayer = Effect.gen(function* () {
  const databasePath = getDatabasePath()

  yield* Effect.tryPromise({
    try: () => mkdir(dirname(databasePath), { recursive: true }),
    catch: (cause) =>
      new DatabaseBootstrapError({
        stage: 'mkdir',
        message: `Failed to prepare database directory for ${databasePath}`,
        cause,
      }),
  })

  const sqliteLayer = SqliteClient.layer({
    filename: databasePath,
    prepareCacheSize: SQLITE_PREPARE_CACHE_SIZE,
  }).pipe(
    Layer.mapError(
      (cause) =>
        new DatabaseBootstrapError({
          stage: 'connect',
          message: `Failed to open database at ${databasePath}`,
          cause,
        }),
    ),
  )

  const setupLayer = Layer.effectDiscard(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient

      yield* sql.unsafe('PRAGMA journal_mode = WAL;')
      yield* sql.unsafe('PRAGMA foreign_keys = ON;')
      yield* sql.unsafe('PRAGMA busy_timeout = 5000;')
      yield* runMigrations
    }).pipe(
      Effect.mapError(
        (cause) =>
          new DatabaseBootstrapError({
            stage: 'setup',
            message: `Failed to initialize database at ${databasePath}`,
            cause,
          }),
      ),
    ),
  )

  return Layer.mergeAll(
    sqliteLayer,
    Layer.succeed(AppDatabase, { path: databasePath } satisfies AppDatabaseService),
    setupLayer.pipe(Layer.provide(sqliteLayer)),
  )
}).pipe(Layer.unwrapEffect)

export const AppDatabaseLive = makeDatabaseLayer

import { mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import * as SqlClient from '@effect/sql/SqlClient'
import { SqliteClient } from '@effect/sql-sqlite-node'
import { Context, Effect, Layer } from 'effect'
import { app } from 'electron'
import { DatabaseBootstrapError } from '../errors'

const DATABASE_FILE_NAME = 'openwaggle.db'
// Not centralized in @shared/constants/ — this is a low-level SQLite driver
// tuning knob (prepared statement LRU cache), not application-level configuration.
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
    ],
  },
  {
    id: 5,
    name: 'pi-session-projection-core',
    statements: [
      `
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        pi_session_id TEXT NOT NULL UNIQUE,
        pi_session_file TEXT,
        project_path TEXT,
        title TEXT NOT NULL,
        archived INTEGER NOT NULL DEFAULT 0,
        waggle_config_json TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        last_active_node_id TEXT,
        last_active_branch_id TEXT
      )
      `,
      `
      CREATE INDEX IF NOT EXISTS idx_sessions_updated_at
      ON sessions (updated_at DESC)
      `,
      `
      CREATE TABLE IF NOT EXISTS session_nodes (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        parent_id TEXT REFERENCES session_nodes(id) ON DELETE CASCADE,
        pi_entry_type TEXT NOT NULL,
        kind TEXT NOT NULL,
        role TEXT,
        timestamp_ms INTEGER NOT NULL,
        content_json TEXT NOT NULL,
        metadata_json TEXT NOT NULL,
        branch_hint_id TEXT,
        path_depth INTEGER NOT NULL,
        created_order INTEGER NOT NULL
      )
      `,
      `
      CREATE INDEX IF NOT EXISTS idx_session_nodes_session_created_order
      ON session_nodes (session_id, created_order ASC)
      `,
      `
      CREATE UNIQUE INDEX IF NOT EXISTS idx_session_nodes_session_created_order_unique
      ON session_nodes (session_id, created_order)
      `,
      `
      CREATE TABLE IF NOT EXISTS session_branches (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        source_node_id TEXT REFERENCES session_nodes(id),
        head_node_id TEXT REFERENCES session_nodes(id),
        name TEXT NOT NULL,
        is_main INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
      `,
      `
      CREATE INDEX IF NOT EXISTS idx_session_branches_session_updated_at
      ON session_branches (session_id, updated_at DESC)
      `,
      `
      CREATE TABLE IF NOT EXISTS session_branch_state (
        branch_id TEXT PRIMARY KEY REFERENCES session_branches(id) ON DELETE CASCADE,
        future_mode TEXT NOT NULL,
        waggle_preset_id TEXT,
        waggle_config_json TEXT,
        last_active_at INTEGER NOT NULL,
        ui_state_json TEXT NOT NULL
      )
      `,
      `
      CREATE TABLE IF NOT EXISTS session_tree_ui_state (
        session_id TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
        expanded_node_ids_json TEXT NOT NULL,
        branches_sidebar_collapsed INTEGER NOT NULL DEFAULT 0,
        updated_at INTEGER NOT NULL
      )
      `,
      `
      CREATE TABLE IF NOT EXISTS session_active_runs (
        run_id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        branch_id TEXT NOT NULL REFERENCES session_branches(id) ON DELETE CASCADE,
        run_mode TEXT NOT NULL,
        status TEXT NOT NULL,
        runtime_json TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      )
      `,
    ],
  },
  {
    id: 8,
    name: 'drop-legacy-pre-pi-persistence',
    statements: [
      `DROP TABLE IF EXISTS conversation_message_parts`,
      `DROP TABLE IF EXISTS pinned_context`,
      `DROP TABLE IF EXISTS conversation_messages`,
      `DROP TABLE IF EXISTS conversations`,
      `DROP TABLE IF EXISTS orchestration_run_tasks`,
      `DROP TABLE IF EXISTS orchestration_runs`,
      `DROP TABLE IF EXISTS orchestration_events`,
      `DROP TABLE IF EXISTS provider_session_runtime`,
      `DROP TABLE IF EXISTS team_runtime_state`,
      `DROP TABLE IF EXISTS auth_tokens`,
      `
      DELETE FROM settings_store
      WHERE key IN (
        'providers',
        'executionMode',
        'qualityPreset',
        'mcpServers'
      )
      `,
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

import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import * as SqlClient from '@effect/sql/SqlClient'
import { SqliteClient } from '@effect/sql-sqlite-node'
import Database from 'better-sqlite3'
import * as Effect from 'effect/Effect'
import { afterEach, describe, expect, it } from 'vitest'
import { SQLITE_PREPARE_CACHE_SIZE } from '../database-constants'
import {
  HIVE_TOOL_NAME_MIGRATION,
  HIVE_TOOL_NAME_MIGRATION_STATEMENTS,
} from '../hive-tool-name-migration'
import { SESSION_HOST_SUPPORTED_MAX_MIGRATION_ID } from '../session-host-schema-identity'

const PROFILE_TABLE = `CREATE TABLE session_execution_profiles (
  session_id TEXT PRIMARY KEY,
  profile_json TEXT NOT NULL,
  resolved_agent_snapshot_json TEXT,
  updated_at INTEGER NOT NULL
)`

function profile(tools?: readonly string[]) {
  return JSON.stringify({
    modelId: 'openai/gpt-5.5',
    thinkingLevel: 'high',
    agentDefinitionName: 'coordinator',
    ...(tools ? { tools } : {}),
  })
}

function snapshot(tools: readonly string[]) {
  return JSON.stringify({
    schemaVersion: 1,
    name: 'coordinator',
    description: 'Coordinates Workers.',
    tools,
    instructions: 'Coordinate.',
    scope: 'project',
    sourcePath: '/repo/.openwaggle/agents/coordinator.md',
    contentDigest: '0'.repeat(64),
  })
}

function databaseWith(rows: readonly { id: string; profile: string; snapshot?: string | null }[]) {
  const database = new Database(':memory:')
  database.exec(PROFILE_TABLE)
  const insert = database.prepare('INSERT INTO session_execution_profiles VALUES (?, ?, ?, 1)')
  for (const row of rows) insert.run(row.id, row.profile, row.snapshot ?? null)
  return database
}

function migrate(database: Database.Database) {
  for (const statement of HIVE_TOOL_NAME_MIGRATION_STATEMENTS) database.exec(statement)
}

interface StoredRow {
  readonly session_id: string
  readonly profile_json: string
  readonly resolved_agent_snapshot_json: string | null
}

function storedRows(database: Database.Database) {
  return database
    .prepare<[], Record<string, unknown>>(
      'SELECT session_id, profile_json, resolved_agent_snapshot_json FROM session_execution_profiles ORDER BY session_id',
    )
    .all()
    .map((row) => ({
      session_id: String(row.session_id),
      profile_json: String(row.profile_json),
      resolved_agent_snapshot_json:
        row.resolved_agent_snapshot_json === null ? null : String(row.resolved_agent_snapshot_json),
    })) satisfies StoredRow[]
}

function storedTools(json: string | null) {
  if (json === null) return null
  const parsed: unknown = JSON.parse(json)
  return typeof parsed === 'object' && parsed !== null ? Reflect.get(parsed, 'tools') : undefined
}

describe('Hive tool name migration (ADR 0053)', () => {
  let tmpRoot = ''
  afterEach(async () => {
    if (tmpRoot) await fs.rm(tmpRoot, { recursive: true, force: true })
    tmpRoot = ''
  })

  it('rewrites sessions to hive in a stored profile and snapshot, keeping their order', () => {
    const database = databaseWith([
      {
        id: 'queen-1',
        profile: profile(['read', 'sessions', 'bash']),
        snapshot: snapshot(['read', 'sessions', 'bash']),
      },
    ])
    try {
      migrate(database)
      const [row] = storedRows(database)
      expect(storedTools(row?.profile_json ?? null)).toEqual(['read', 'hive', 'bash'])
      expect(storedTools(row?.resolved_agent_snapshot_json ?? null)).toEqual([
        'read',
        'hive',
        'bash',
      ])
    } finally {
      database.close()
    }
  })

  it('keeps one hive entry when a profile lists both names', () => {
    const database = databaseWith([{ id: 's', profile: profile(['sessions', 'read', 'hive']) }])
    try {
      migrate(database)
      expect(storedTools(storedRows(database)[0]?.profile_json ?? null)).toEqual(['hive', 'read'])
    } finally {
      database.close()
    }
  })

  it('leaves profiles without sessions byte-for-byte unchanged and is idempotent', () => {
    const database = databaseWith([
      { id: 'a-hive', profile: profile(['read', 'hive']), snapshot: snapshot(['read', 'hive']) },
      { id: 'b-unrestricted', profile: profile() },
      { id: 'c-other', profile: profile(['read', 'mcp__github__*']) },
      { id: 'd-unreadable', profile: '{not json' },
      { id: 'e-sessions', profile: profile(['sessions']) },
    ])
    try {
      const before = storedRows(database)
      migrate(database)
      const once = storedRows(database)
      expect(once.slice(0, 4)).toEqual(before.slice(0, 4))
      expect(storedTools(once[4]?.profile_json ?? null)).toEqual(['hive'])

      migrate(database)
      expect(storedRows(database)).toEqual(once)
    } finally {
      database.close()
    }
  })

  it('runs through the migration runner, and skips a target without the profile table', async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ow-hive-tool-migration-'))
    const run = (file: string, setup: readonly string[]) =>
      Effect.runPromise(
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          for (const statement of setup) yield* sql.unsafe(statement)
          yield* HIVE_TOOL_NAME_MIGRATION.run(sql)
          const tables = yield* sql<{ readonly name: string }>`
            SELECT name FROM sqlite_master WHERE type = 'table'
          `
          if (!tables.some((table) => table.name === 'session_execution_profiles')) return null
          return yield* sql<{ readonly profile_json: string }>`
            SELECT profile_json FROM session_execution_profiles
          `
        }).pipe(
          Effect.provide(
            SqliteClient.layer({
              filename: path.join(tmpRoot, file),
              prepareCacheSize: SQLITE_PREPARE_CACHE_SIZE,
            }),
          ),
        ),
      )

    await expect(run('empty.sqlite', [])).resolves.toBeNull()
    const rows = await run('profiles.sqlite', [
      PROFILE_TABLE,
      `INSERT INTO session_execution_profiles VALUES ('s', '${profile(['sessions'])}', NULL, 1)`,
    ])
    expect(storedTools(rows?.[0]?.profile_json ?? null)).toEqual(['hive'])
  })

  it('is a migration this binary supports', () => {
    expect(SESSION_HOST_SUPPORTED_MAX_MIGRATION_ID).toBeGreaterThanOrEqual(
      HIVE_TOOL_NAME_MIGRATION.id,
    )
    expect(HIVE_TOOL_NAME_MIGRATION.name).toBe('hive-tool-name')
  })
})

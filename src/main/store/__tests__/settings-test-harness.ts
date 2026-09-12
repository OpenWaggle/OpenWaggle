import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import * as SqlClient from '@effect/sql/SqlClient'
import * as Effect from 'effect/Effect'
import { afterEach, beforeEach, vi } from 'vitest'
import {
  REMOVED_PERSISTENCE_MIGRATION_IDS,
  REMOVED_PERSISTENCE_TABLES,
  REMOVED_SETTINGS_KEYS,
  type SettingsStoreRow,
  type TableColumnRow,
  type TableRow,
} from './settings-test-constants'

const state = vi.hoisted(() => ({
  userDataDir: '',
  encryptionAvailable: false,
  encryptThrows: false,
}))

vi.mock('electron', () => ({
  app: {
    getPath: () => state.userDataDir,
  },
  safeStorage: {
    isEncryptionAvailable: () => state.encryptionAvailable,
    encryptString: (value: string) => {
      if (state.encryptThrows) {
        throw new Error('encrypt failed')
      }
      return Buffer.from(value, 'utf8')
    },
    decryptString: (value: Buffer) => value.toString('utf8'),
  },
}))

async function disposeRuntime() {
  const { disposeAppRuntime } = await import('../../runtime')
  await disposeAppRuntime()
}

export function installSettingsStoreTestLifecycle() {
  beforeEach(async () => {
    state.userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-settings-test-'))
    // Deliberately NOT vi.resetModules(). Resetting the registry gave every test its
    // own copy of the runtime module, so each test left a live better-sqlite3
    // Database orphaned in a worker that vitest reuses across files; the accumulated
    // objects then crashed the addon at environment teardown (#151). Resetting the
    // runtime and the settings cache in place gives the same isolation -- a fresh
    // database per test -- with exactly one module instance alive.
    const { resetAppRuntimeForTests } = await import('../../runtime')
    await resetAppRuntimeForTests()
    const { resetSettingsStoreForTests } = await import('../settings')
    await resetSettingsStoreForTests()
    state.encryptionAvailable = false
    state.encryptThrows = false
  })

  afterEach(async () => {
    await disposeRuntime()
    if (state.userDataDir) {
      await fs.rm(state.userDataDir, { recursive: true, force: true })
    }
  })
}

export async function loadSettingsModule() {
  const module = await import('../settings')
  await module.initializeSettingsStore()
  return module
}

export async function writeRawSetting(key: string, value: unknown) {
  await writeRawSettingJson(key, JSON.stringify(value))
}

export async function writeRawSettingJson(key: string, valueJson: string) {
  const { runAppEffect } = await import('../../runtime')
  await runAppEffect(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      yield* sql`
        INSERT INTO settings_store (key, value_json, updated_at)
        VALUES (${key}, ${valueJson}, ${Date.now()})
        ON CONFLICT(key) DO UPDATE SET
          value_json = excluded.value_json,
          updated_at = excluded.updated_at
      `
    }),
  )
}

export async function dropSettingsStoreForFailureTest() {
  const { runAppEffect } = await import('../../runtime')
  await runAppEffect(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      yield* sql`DROP TABLE settings_store`
    }),
  )
}

export async function seedRemovedPersistenceForCleanup() {
  const { resetAppRuntimeForTests, runAppEffect } = await import('../../runtime')
  await runAppEffect(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      for (const tableName of REMOVED_PERSISTENCE_TABLES) {
        yield* sql.unsafe(`CREATE TABLE IF NOT EXISTS ${tableName} (id TEXT PRIMARY KEY)`)
      }
      for (const key of REMOVED_SETTINGS_KEYS) {
        yield* sql`
          INSERT INTO settings_store (key, value_json, updated_at)
          VALUES (${key}, ${JSON.stringify({ removed: true })}, ${Date.now()})
          ON CONFLICT(key) DO UPDATE SET
            value_json = excluded.value_json,
            updated_at = excluded.updated_at
        `
      }
      for (const migrationId of REMOVED_PERSISTENCE_MIGRATION_IDS) {
        yield* sql`
          DELETE FROM _migrations
          WHERE id = ${migrationId}
        `
      }
    }),
  )
  await resetAppRuntimeForTests()
}

export async function readRemovedPersistenceNames() {
  const { runAppEffect } = await import('../../runtime')
  return runAppEffect(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const tableRows = yield* sql<TableRow>`
        SELECT name
        FROM sqlite_master
        WHERE type = ${'table'}
          AND name IN ${sql.in([...REMOVED_PERSISTENCE_TABLES])}
        ORDER BY name ASC
      `
      const settingRows = yield* sql<SettingsStoreRow>`
        SELECT key
        FROM settings_store
        WHERE key IN ${sql.in([...REMOVED_SETTINGS_KEYS])}
        ORDER BY key ASC
      `
      return {
        tables: tableRows.map((row) => row.name),
        settingsKeys: settingRows.map((row) => row.key),
      }
    }),
  )
}

export async function readTableColumns(tableName: string) {
  const { runAppEffect } = await import('../../runtime')
  return runAppEffect(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const rows = yield* sql<TableColumnRow>`
        SELECT name
        FROM pragma_table_info(${tableName})
      `
      return rows.map((row) => row.name)
    }),
  )
}

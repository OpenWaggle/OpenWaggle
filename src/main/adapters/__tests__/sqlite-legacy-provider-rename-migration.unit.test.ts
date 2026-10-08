import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import * as SqlClient from '@effect/sql/SqlClient'
import { SqliteClient } from '@effect/sql-sqlite-node'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SQLITE_PREPARE_CACHE_SIZE } from '../../services/database-constants'
import { migrateLegacyProviderReferences } from '../sqlite-legacy-provider-rename-migration'

let tmpRoot = ''

function databaseLayer() {
  const sqlite = SqliteClient.layer({
    filename: path.join(tmpRoot, 'app.db'),
    prepareCacheSize: SQLITE_PREPARE_CACHE_SIZE,
  })
  const schema = Layer.effectDiscard(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      yield* sql.unsafe(`CREATE TABLE settings_store (
        key TEXT PRIMARY KEY, value_json TEXT NOT NULL, updated_at INTEGER NOT NULL
      )`)
      yield* sql.unsafe(`CREATE TABLE session_execution_profiles (
        session_id TEXT PRIMARY KEY, profile_json TEXT NOT NULL, updated_at INTEGER NOT NULL
      )`)
    }).pipe(Effect.provide(sqlite)),
  )
  return Layer.merge(sqlite, schema)
}

function seedSetting(key: string, value: unknown) {
  return SqlClient.SqlClient.pipe(
    Effect.flatMap(
      (sql) => sql`
        INSERT INTO settings_store (key, value_json, updated_at)
        VALUES (${key}, ${JSON.stringify(value)}, ${1})
      `,
    ),
  )
}

function seedProfile(sessionId: string, profile: Record<string, string>) {
  return SqlClient.SqlClient.pipe(
    Effect.flatMap(
      (sql) => sql`
        INSERT INTO session_execution_profiles (session_id, profile_json, updated_at)
        VALUES (${sessionId}, ${JSON.stringify(profile)}, ${1})
      `,
    ),
  )
}

function storedSettings() {
  return Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const rows = yield* sql<{ readonly key: string; readonly value_json: string }>`
      SELECT key, value_json FROM settings_store ORDER BY key
    `
    return Object.fromEntries(rows.map((row) => [row.key, JSON.parse(row.value_json)]))
  })
}

function storedProfiles() {
  return Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const rows = yield* sql<{ readonly session_id: string; readonly profile_json: string }>`
      SELECT session_id, profile_json FROM session_execution_profiles ORDER BY session_id
    `
    return Object.fromEntries(rows.map((row) => [row.session_id, JSON.parse(row.profile_json)]))
  })
}

function run<A>(effect: Effect.Effect<A, unknown, SqlClient.SqlClient>) {
  return Effect.runPromise(effect.pipe(Effect.provide(databaseLayer())))
}

beforeEach(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-provider-rename-'))
})

afterEach(async () => {
  await fs.rm(tmpRoot, { recursive: true, force: true })
})

describe('legacy provider rename migration', () => {
  it("moves every stored Azure model choice and Session profile to Pi's new provider id", async () => {
    const result = await run(
      Effect.gen(function* () {
        yield* seedSetting('selectedModel', 'azure-openai-responses/gpt-5.4')
        yield* seedSetting('favoriteModels', ['azure-openai-responses/gpt-5.5', 'openai/gpt-5.4'])
        yield* seedSetting('enabledModels', ['azure-openai-responses/gpt-5.4'])
        yield* seedSetting('selectedModelsByProject', {
          '/project': 'azure-openai-responses/gpt-5.4',
          '/other': 'anthropic/claude-sonnet-5',
        })
        yield* seedSetting('sessionTitleModel', 'azure-openai-responses/gpt-5.4-mini')
        yield* seedSetting('diffView', 'split')
        yield* seedProfile('azure-session', {
          modelId: 'azure-openai-responses/gpt-5.4',
          thinkingLevel: 'high',
        })
        yield* seedProfile('openai-session', { modelId: 'openai/gpt-5.4', thinkingLevel: 'low' })
        yield* migrateLegacyProviderReferences
        return { settings: yield* storedSettings(), profiles: yield* storedProfiles() }
      }),
    )

    expect(result.settings).toMatchObject({
      selectedModel: 'azure/gpt-5.4',
      favoriteModels: ['azure/gpt-5.5', 'openai/gpt-5.4'],
      enabledModels: ['azure/gpt-5.4'],
      selectedModelsByProject: {
        '/project': 'azure/gpt-5.4',
        '/other': 'anthropic/claude-sonnet-5',
      },
      sessionTitleModel: 'azure/gpt-5.4-mini',
      diffView: 'split',
    })
    expect(result.profiles).toEqual({
      'azure-session': { modelId: 'azure/gpt-5.4', thinkingLevel: 'high' },
      'openai-session': { modelId: 'openai/gpt-5.4', thinkingLevel: 'low' },
    })
  })

  it('moves references again after a downgrade wrote the old id, at every Host start', async () => {
    const result = await run(
      Effect.gen(function* () {
        yield* seedSetting('selectedModel', 'azure-openai-responses/gpt-5.4')
        yield* migrateLegacyProviderReferences
        // An older OpenWaggle, run in between, stores the old id again.
        const sql = yield* SqlClient.SqlClient
        yield* sql`
          UPDATE settings_store SET value_json = ${JSON.stringify('azure-openai-responses/gpt-5.5')}
          WHERE key = ${'selectedModel'}
        `
        yield* seedProfile('downgraded-session', { modelId: 'azure-openai-responses/gpt-5.4' })
        yield* migrateLegacyProviderReferences
        return { settings: yield* storedSettings(), profiles: yield* storedProfiles() }
      }),
    )

    expect(result.settings).toEqual({ selectedModel: 'azure/gpt-5.5' })
    expect(result.profiles).toEqual({ 'downgraded-session': { modelId: 'azure/gpt-5.4' } })
  })

  it('writes nothing when no stored reference names an old provider id', async () => {
    const result = await run(
      Effect.gen(function* () {
        yield* seedSetting('selectedModel', 'azure/gpt-5.4')
        yield* seedProfile('azure-session', { modelId: 'azure/gpt-5.4' })
        yield* migrateLegacyProviderReferences
        const sql = yield* SqlClient.SqlClient
        return yield* sql<{ readonly updated_at: number }>`
          SELECT updated_at FROM settings_store
          UNION ALL SELECT updated_at FROM session_execution_profiles
        `
      }),
    )

    expect(result.map((row) => row.updated_at)).toEqual([1, 1])
  })
})

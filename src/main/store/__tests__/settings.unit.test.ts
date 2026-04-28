import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import * as SqlClient from '@effect/sql/SqlClient'
import { SupportedModelId } from '@shared/types/brand'
import * as Effect from 'effect/Effect'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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

interface SettingsStoreRow {
  readonly key: string
}

interface LegacyTableRow {
  readonly name: string
}

const LEGACY_CLEANUP_MIGRATION_ID = 8
const LEGACY_PERSISTENCE_TABLES = [
  'conversation_message_parts',
  'pinned_context',
  'conversation_messages',
  'conversations',
  'orchestration_run_tasks',
  'orchestration_runs',
  'orchestration_events',
  'provider_session_runtime',
  'team_runtime_state',
  'auth_tokens',
] as const
const LEGACY_SETTINGS_KEYS = ['providers', 'executionMode', 'qualityPreset', 'mcpServers'] as const

async function disposeRuntime(): Promise<void> {
  const { disposeAppRuntime } = await import('../../runtime')
  await disposeAppRuntime()
}

async function loadSettingsModule() {
  const module = await import('../settings')
  await module.initializeSettingsStore()
  return module
}

async function writeRawSetting(key: string, value: unknown): Promise<void> {
  const { runAppEffect } = await import('../../runtime')
  await runAppEffect(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      yield* sql`
        INSERT INTO settings_store (key, value_json, updated_at)
        VALUES (${key}, ${JSON.stringify(value)}, ${Date.now()})
        ON CONFLICT(key) DO UPDATE SET
          value_json = excluded.value_json,
          updated_at = excluded.updated_at
      `
    }),
  )
}

async function seedLegacyPersistenceForCleanup(): Promise<void> {
  const { resetAppRuntimeForTests, runAppEffect } = await import('../../runtime')
  await runAppEffect(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      for (const tableName of LEGACY_PERSISTENCE_TABLES) {
        yield* sql.unsafe(`CREATE TABLE IF NOT EXISTS ${tableName} (id TEXT PRIMARY KEY)`)
      }
      for (const key of LEGACY_SETTINGS_KEYS) {
        yield* sql`
          INSERT INTO settings_store (key, value_json, updated_at)
          VALUES (${key}, ${JSON.stringify({ legacy: true })}, ${Date.now()})
          ON CONFLICT(key) DO UPDATE SET
            value_json = excluded.value_json,
            updated_at = excluded.updated_at
        `
      }
      yield* sql`
        DELETE FROM _migrations
        WHERE id = ${LEGACY_CLEANUP_MIGRATION_ID}
      `
    }),
  )
  await resetAppRuntimeForTests()
}

async function readLegacyPersistenceNames(): Promise<{
  readonly tables: readonly string[]
  readonly settingsKeys: readonly string[]
}> {
  const { runAppEffect } = await import('../../runtime')
  return runAppEffect(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const tableRows = yield* sql<LegacyTableRow>`
        SELECT name
        FROM sqlite_master
        WHERE type = ${'table'}
          AND name IN ${sql.in([...LEGACY_PERSISTENCE_TABLES])}
        ORDER BY name ASC
      `
      const settingRows = yield* sql<SettingsStoreRow>`
        SELECT key
        FROM settings_store
        WHERE key IN ${sql.in([...LEGACY_SETTINGS_KEYS])}
        ORDER BY key ASC
      `
      return {
        tables: tableRows.map((row) => row.name),
        settingsKeys: settingRows.map((row) => row.key),
      }
    }),
  )
}

describe('settings store', () => {
  beforeEach(async () => {
    await disposeRuntime()
    vi.resetModules()
    state.userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-settings-test-'))
    state.encryptionAvailable = false
    state.encryptThrows = false
  })

  afterEach(async () => {
    await disposeRuntime()
    if (state.userDataDir) {
      await fs.rm(state.userDataDir, { recursive: true, force: true })
    }
  })

  it('drops pre-Pi persistence tables and settings keys during database bootstrap', async () => {
    await seedLegacyPersistenceForCleanup()

    const legacyPersistence = await readLegacyPersistenceNames()

    expect(legacyPersistence).toEqual({
      tables: [],
      settingsKeys: [],
    })
  })

  it('sanitizes and limits recent projects from persisted settings', async () => {
    await writeRawSetting('recentProjects', [
      '/tmp/repo-1',
      '/tmp/repo-1',
      '   /tmp/repo-2   ',
      '/tmp/repo-3',
      '/tmp/repo-4',
      '/tmp/repo-5',
      '/tmp/repo-6',
      '/tmp/repo-7',
      '/tmp/repo-8',
      '/tmp/repo-9',
      '/tmp/repo-10',
      '/tmp/repo-11',
    ])

    const { getSettings } = await loadSettingsModule()
    const settings = getSettings()

    expect(settings.recentProjects).toEqual([
      '/tmp/repo-1',
      '/tmp/repo-2',
      '/tmp/repo-3',
      '/tmp/repo-4',
      '/tmp/repo-5',
      '/tmp/repo-6',
      '/tmp/repo-7',
      '/tmp/repo-8',
      '/tmp/repo-9',
      '/tmp/repo-10',
    ])
  })

  it('falls back to medium thinking level when persisted value is invalid', async () => {
    await writeRawSetting('thinkingLevel', 'ultra')

    const { getSettings } = await loadSettingsModule()
    const settings = getSettings()

    expect(settings.thinkingLevel).toBe('medium')
  })

  it('sanitizes and limits favorite models from persisted settings', async () => {
    await writeRawSetting('favoriteModels', [
      'openai/gpt-4.1-mini',
      'openai/gpt-4.1-mini',
      ' anthropic/claude-sonnet-4-5 ',
      '',
      ...Array.from({ length: 110 }, (_value, index) => `openrouter/model-${String(index)}`),
    ])

    const { getSettings } = await loadSettingsModule()
    const settings = getSettings()

    expect(settings.favoriteModels[0]).toBe('openai/gpt-4.1-mini')
    expect(settings.favoriteModels[1]).toBe('anthropic/claude-sonnet-4-5')
    expect(settings.favoriteModels).toHaveLength(100)
  })

  it('sanitizes skill toggles by project', async () => {
    await writeRawSetting('skillTogglesByProject', {
      ' /tmp/repo ': {
        ' code-review ': false,
        '': true,
      },
      '': {
        'frontend-design': true,
      },
    })

    const { getSettings } = await loadSettingsModule()
    const settings = getSettings()

    expect(settings.skillTogglesByProject).toEqual({
      '/tmp/repo': {
        'code-review': false,
      },
    })
  })

  it('roundtrips valid thinkingLevel through updateSettings', async () => {
    const { getSettings, updateSettings } = await loadSettingsModule()
    updateSettings({ thinkingLevel: 'high' })
    expect(getSettings().thinkingLevel).toBe('high')
  })

  it('roundtrips recentProjects through updateSettings', async () => {
    const { getSettings, updateSettings } = await loadSettingsModule()
    updateSettings({ recentProjects: ['/tmp/a', '/tmp/b'] })
    expect(getSettings().recentProjects).toEqual(['/tmp/a', '/tmp/b'])
  })

  it('roundtrips favoriteModels through updateSettings', async () => {
    const { getSettings, updateSettings } = await loadSettingsModule()
    updateSettings({
      favoriteModels: [
        SupportedModelId('openai/gpt-4.1-mini'),
        SupportedModelId('openai/gpt-4.1-mini'),
        SupportedModelId(' anthropic/claude-sonnet-4-5 '),
        SupportedModelId(''),
      ],
    })
    expect(getSettings().favoriteModels).toEqual([
      'openai/gpt-4.1-mini',
      'anthropic/claude-sonnet-4-5',
    ])
  })

  it('normalizes selectedModel through updateSettings', async () => {
    const { getSettings, updateSettings } = await loadSettingsModule()
    updateSettings({
      enabledModels: [SupportedModelId('openai-codex/gpt-5.4')],
      selectedModel: SupportedModelId('openai-codex/gpt-5.4'),
    })
    expect(getSettings().selectedModel).toBe('openai-codex/gpt-5.4')

    updateSettings({ selectedModel: SupportedModelId('gpt-5.4') })
    expect(getSettings().selectedModel).toBe('')
  })

  it('roundtrips skillTogglesByProject through updateSettings', async () => {
    const { getSettings, updateSettings } = await loadSettingsModule()
    updateSettings({
      skillTogglesByProject: {
        '/tmp/repo': { 'code-review': true, 'frontend-design': false },
      },
    })
    expect(getSettings().skillTogglesByProject).toEqual({
      '/tmp/repo': { 'code-review': true, 'frontend-design': false },
    })
  })
})

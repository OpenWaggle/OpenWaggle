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
  isKnownModel: vi.fn((modelId: string) => modelId === 'claude-sonnet-4-5'),
  getProvider: vi.fn(),
  indexModels: vi.fn(),
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

vi.mock('../../providers', () => ({
  providerRegistry: {
    isKnownModel: state.isKnownModel,
    get: state.getProvider,
    indexModels: state.indexModels,
  },
}))

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

async function readRawSetting(key: string): Promise<unknown> {
  const { runAppEffect } = await import('../../runtime')
  return runAppEffect(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const rows = yield* sql<{ value_json: string }>`
        SELECT value_json
        FROM settings_store
        WHERE key = ${key}
        LIMIT 1
      `
      return rows[0]?.value_json ? JSON.parse(rows[0].value_json) : undefined
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
    state.isKnownModel.mockReset()
    state.isKnownModel.mockImplementation((modelId: string) => modelId === 'claude-sonnet-4-5')
    state.getProvider.mockReset()
    state.indexModels.mockReset()
  })

  afterEach(async () => {
    await disposeRuntime()
    if (state.userDataDir) {
      await fs.rm(state.userDataDir, { recursive: true, force: true })
    }
  })

  it('defaults execution mode to default-permissions for new installs', async () => {
    const { getSettings } = await loadSettingsModule()
    const settings = getSettings()
    expect(settings.executionMode).toBe('default-permissions')
  })

  it('uses persisted execution mode when present', async () => {
    await writeRawSetting('executionMode', 'full-access')

    const { getSettings } = await loadSettingsModule()
    const settings = getSettings()

    expect(settings.executionMode).toBe('full-access')
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

  it('falls back to medium quality when persisted preset is invalid', async () => {
    await writeRawSetting('qualityPreset', 'ultra')

    const { getSettings } = await loadSettingsModule()
    const settings = getSettings()

    expect(settings.qualityPreset).toBe('medium')
  })

  it('sanitizes and limits favorite models from persisted settings', async () => {
    await writeRawSetting('favoriteModels', [
      'gpt-4.1-mini',
      'gpt-4.1-mini',
      ' claude-sonnet-4-5 ',
      '',
      ...Array.from({ length: 110 }, (_value, index) => `openrouter/model-${String(index)}`),
    ])

    const { getSettings } = await loadSettingsModule()
    const settings = getSettings()

    expect(settings.favoriteModels[0]).toBe('gpt-4.1-mini')
    expect(settings.favoriteModels[1]).toBe('claude-sonnet-4-5')
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

  it('roundtrips valid executionMode through updateSettings', async () => {
    const { getSettings, updateSettings } = await loadSettingsModule()
    updateSettings({ executionMode: 'full-access' })
    expect(getSettings().executionMode).toBe('full-access')
  })

  it('rejects invalid executionMode in updateSettings', async () => {
    const { getSettings, updateSettings } = await loadSettingsModule()
    Reflect.apply(updateSettings, undefined, [{ executionMode: 'yolo' }])
    expect(getSettings().executionMode).toBe('default-permissions')
  })

  it('roundtrips valid qualityPreset through updateSettings', async () => {
    const { getSettings, updateSettings } = await loadSettingsModule()
    updateSettings({ qualityPreset: 'high' })
    expect(getSettings().qualityPreset).toBe('high')
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
        SupportedModelId('gpt-4.1-mini'),
        SupportedModelId('gpt-4.1-mini'),
        SupportedModelId(' claude-sonnet-4-5 '),
        SupportedModelId(''),
      ],
    })
    expect(getSettings().favoriteModels).toEqual(['gpt-4.1-mini', 'claude-sonnet-4-5'])
  })

  it('preserves and indexes a persisted dynamic default model when enabledModels identify the provider', async () => {
    state.isKnownModel.mockImplementation(() => false)
    state.getProvider.mockReturnValue({ id: 'openai' })

    await writeRawSetting('selectedModel', 'gpt-5.4')
    await writeRawSetting('enabledModels', ['openai:subscription:gpt-5.4'])

    const { getSettings } = await loadSettingsModule()

    expect(getSettings().selectedModel).toBe('gpt-5.4')
    expect(state.getProvider).toHaveBeenCalledWith('openai')
    expect(state.indexModels).toHaveBeenCalledWith(
      ['gpt-5.4'],
      expect.objectContaining({ id: 'openai' }),
    )
  })

  it('preserves provider authMethod when provider updates omit it', async () => {
    await writeRawSetting('providers', {
      openai: { apiKey: 'sk-existing', enabled: true, authMethod: 'subscription' },
    })

    const { getSettings, updateSettings } = await loadSettingsModule()

    updateSettings({
      providers: {
        openai: {
          apiKey: 'sk-next',
          enabled: true,
        },
      },
    })

    expect(getSettings().providers.openai?.authMethod).toBe('subscription')
  })

  it('auto-migrates plaintext provider API keys when encryption becomes available', async () => {
    state.encryptionAvailable = true
    await writeRawSetting('providers', {
      openai: { apiKey: 'sk-plain', enabled: true, authMethod: 'api-key' },
    })

    const { getSettings } = await loadSettingsModule()
    const settings = getSettings()

    expect(settings.providers.openai?.apiKey).toBe('sk-plain')
    expect(settings.apiKeysRequireManualResave).toBe(false)

    await import('../settings').then((module) => module.flushSettingsStoreForTests())
    const storedProviders = await readRawSetting('providers')
    expect(storedProviders).toMatchObject({
      openai: {
        apiKey: expect.stringMatching(/^enc:v1:/),
      },
    })
  })

  it('flags manual re-save when plaintext API key migration fails', async () => {
    state.encryptionAvailable = true
    state.encryptThrows = true
    await writeRawSetting('providers', {
      openai: { apiKey: 'sk-plain', enabled: true, authMethod: 'api-key' },
    })

    const { getSettings } = await loadSettingsModule()
    const settings = getSettings()

    expect(settings.providers.openai?.apiKey).toBe('sk-plain')
    expect(settings.apiKeysRequireManualResave).toBe(true)
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

import { SupportedModelId } from '@shared/types/brand'
import { beforeEach, describe, expect, it, vi } from 'vitest'

type MockStoreValue = string | number | boolean | null | undefined | object

interface MockStoreData {
  [key: string]: MockStoreValue
}

const mockState = vi.hoisted(() => ({
  fsExists: false,
  fsRaw: '',
  storeData: {} as MockStoreData,
  setCalls: [] as Array<{ key: string; value: unknown }>,
  isKnownModel: vi.fn((modelId: string) => modelId === 'claude-sonnet-4-5'),
  encryptionAvailable: false,
  encryptThrows: false,
}))

vi.mock('node:fs', () => {
  const existsSync = vi.fn(() => mockState.fsExists)
  const readFileSync = vi.fn(() => mockState.fsRaw)
  return {
    default: { existsSync, readFileSync },
    existsSync,
    readFileSync,
  }
})

vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: () => mockState.encryptionAvailable,
    encryptString: (value: string) => {
      if (mockState.encryptThrows) {
        throw new Error('encrypt failed')
      }
      return Buffer.from(value, 'utf8')
    },
    decryptString: (value: Buffer) => value.toString('utf8'),
  },
}))

vi.mock('../providers', () => ({
  providerRegistry: {
    isKnownModel: mockState.isKnownModel,
  },
}))

vi.mock('electron-store', () => {
  class MockStore<T extends object> {
    path = '/mock/settings.json'
    private data: MockStoreData

    constructor(options: { defaults?: Partial<T> }) {
      this.data = {
        ...(options.defaults ?? {}),
        ...mockState.storeData,
      }
    }

    get<K extends keyof T>(key: K, defaultValue?: T[K]): T[K] {
      const keyName = String(key)
      const value = this.data[keyName]
      if (value !== undefined) {
        return value as T[K]
      }
      if (defaultValue !== undefined) {
        return defaultValue
      }
      throw new Error(`Missing settings key: ${keyName}`)
    }

    set<K extends keyof T>(key: K, value: T[K]): void {
      const keyName = String(key)
      this.data[keyName] = value as MockStoreValue
      mockState.storeData[keyName] = value as MockStoreValue
      mockState.setCalls.push({ key: String(key), value })
      // Keep file mock in sync so resolveExecutionMode (which reads raw file) works
      mockState.fsExists = true
      mockState.fsRaw = JSON.stringify(mockState.storeData)
    }
  }

  return { default: MockStore }
})

async function loadSettingsModule() {
  vi.resetModules()
  return import('./settings')
}

describe('settings store', () => {
  beforeEach(() => {
    mockState.fsExists = false
    mockState.fsRaw = ''
    mockState.storeData = {}
    mockState.setCalls = []
    mockState.isKnownModel.mockReset()
    mockState.isKnownModel.mockImplementation((modelId: string) => modelId === 'claude-sonnet-4-5')
    mockState.encryptionAvailable = false
    mockState.encryptThrows = false
  })

  it('defaults execution mode to sandbox for new installs', async () => {
    const { getSettings } = await loadSettingsModule()
    const settings = getSettings()
    expect(settings.executionMode).toBe('sandbox')
  })

  it('migrates legacy profiles to full-access when execution mode is absent', async () => {
    mockState.fsExists = true
    mockState.fsRaw = JSON.stringify({
      providers: {
        openai: { apiKey: 'sk-test', enabled: true },
      },
      projectPath: '/tmp/repo',
    })

    const { getSettings } = await loadSettingsModule()
    const settings = getSettings()

    expect(settings.executionMode).toBe('full-access')
    expect(mockState.setCalls).toContainEqual({ key: 'executionMode', value: 'full-access' })
  })

  it('uses persisted execution mode when present', async () => {
    mockState.fsExists = true
    mockState.fsRaw = JSON.stringify({ executionMode: 'sandbox' })

    const { getSettings } = await loadSettingsModule()
    const settings = getSettings()

    expect(settings.executionMode).toBe('sandbox')
    expect(mockState.setCalls.find((call) => call.key === 'executionMode')).toBeUndefined()
  })

  it('sanitizes and limits recent projects from persisted settings', async () => {
    mockState.storeData.recentProjects = [
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
    ]

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
    mockState.storeData.qualityPreset = 'ultra'

    const { getSettings } = await loadSettingsModule()
    const settings = getSettings()

    expect(settings.qualityPreset).toBe('medium')
  })

  it('sanitizes and limits favorite models from persisted settings', async () => {
    mockState.storeData.favoriteModels = [
      'gpt-4.1-mini',
      'gpt-4.1-mini',
      ' claude-sonnet-4-5 ',
      '',
      ...Array.from({ length: 110 }, (_value, index) => `openrouter/model-${String(index)}`),
    ]

    const { getSettings } = await loadSettingsModule()
    const settings = getSettings()

    expect(settings.favoriteModels[0]).toBe('gpt-4.1-mini')
    expect(settings.favoriteModels[1]).toBe('claude-sonnet-4-5')
    expect(settings.favoriteModels).toHaveLength(100)
  })

  it('sanitizes skill toggles by project', async () => {
    mockState.storeData.skillTogglesByProject = {
      ' /tmp/repo ': {
        ' code-review ': false,
        '': true,
      },
      '': {
        'frontend-design': true,
      },
    }

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
    const settings = getSettings()
    expect(settings.executionMode).toBe('full-access')
  })

  it('rejects invalid executionMode in updateSettings', async () => {
    const { getSettings, updateSettings } = await loadSettingsModule()
    updateSettings({ executionMode: 'yolo' as 'sandbox' })
    const settings = getSettings()
    expect(settings.executionMode).toBe('sandbox')
    expect(
      mockState.setCalls.find((c) => c.key === 'executionMode' && c.value === 'yolo'),
    ).toBeUndefined()
  })

  it('roundtrips valid orchestrationMode through updateSettings', async () => {
    const { getSettings, updateSettings } = await loadSettingsModule()
    updateSettings({ orchestrationMode: 'classic' })
    const settings = getSettings()
    expect(settings.orchestrationMode).toBe('classic')
  })

  it('rejects invalid orchestrationMode in updateSettings', async () => {
    const { getSettings, updateSettings } = await loadSettingsModule()
    updateSettings({ orchestrationMode: 'turbo' as 'classic' })
    const settings = getSettings()
    expect(settings.orchestrationMode).toBe('auto-fallback')
    expect(
      mockState.setCalls.find((c) => c.key === 'orchestrationMode' && c.value === 'turbo'),
    ).toBeUndefined()
  })

  it('roundtrips valid qualityPreset through updateSettings', async () => {
    const { getSettings, updateSettings } = await loadSettingsModule()
    updateSettings({ qualityPreset: 'high' })
    const settings = getSettings()
    expect(settings.qualityPreset).toBe('high')
  })

  it('rejects invalid qualityPreset in updateSettings', async () => {
    const { getSettings, updateSettings } = await loadSettingsModule()
    updateSettings({ qualityPreset: 'ultra' as 'medium' })
    const settings = getSettings()
    expect(settings.qualityPreset).toBe('medium')
    expect(
      mockState.setCalls.find((c) => c.key === 'qualityPreset' && c.value === 'ultra'),
    ).toBeUndefined()
  })

  it('roundtrips recentProjects through updateSettings', async () => {
    const { getSettings, updateSettings } = await loadSettingsModule()
    updateSettings({ recentProjects: ['/tmp/a', '/tmp/b'] })
    const settings = getSettings()
    expect(settings.recentProjects).toEqual(['/tmp/a', '/tmp/b'])
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
    const settings = getSettings()
    expect(settings.favoriteModels).toEqual(['gpt-4.1-mini', 'claude-sonnet-4-5'])
  })

  it('preserves provider authMethod when provider updates omit it', async () => {
    mockState.storeData.providers = {
      openai: { apiKey: 'sk-existing', enabled: true, authMethod: 'subscription' },
    }

    const { getSettings, updateSettings } = await loadSettingsModule()

    updateSettings({
      providers: {
        openai: {
          apiKey: 'sk-next',
          enabled: true,
        },
      },
    })

    expect(mockState.storeData.providers).toEqual({
      openai: expect.objectContaining({ authMethod: 'subscription' }),
    })

    const settings = getSettings()
    expect(settings.providers.openai?.authMethod).toBe('subscription')
  })

  it('auto-migrates plaintext provider API keys when encryption becomes available', async () => {
    mockState.encryptionAvailable = true
    mockState.storeData.providers = {
      openai: { apiKey: 'sk-plain', enabled: true, authMethod: 'api-key' },
    }

    const { getSettings } = await loadSettingsModule()
    const settings = getSettings()

    expect(settings.providers.openai?.apiKey).toBe('sk-plain')
    expect(settings.apiKeysRequireManualResave).toBe(false)

    const providersUpdate = mockState.setCalls.find((call) => call.key === 'providers')
    expect(providersUpdate).toBeDefined()
    if (!providersUpdate) {
      throw new Error('Expected providers update call')
    }
    const providersValue = providersUpdate.value
    if (!providersValue || typeof providersValue !== 'object' || Array.isArray(providersValue)) {
      throw new Error('Expected providers update payload to be an object')
    }
    const openaiValue = Reflect.get(providersValue, 'openai')
    if (!openaiValue || typeof openaiValue !== 'object' || Array.isArray(openaiValue)) {
      throw new Error('Expected openai provider payload')
    }
    const apiKeyValue = Reflect.get(openaiValue, 'apiKey')
    expect(typeof apiKeyValue).toBe('string')
    if (typeof apiKeyValue !== 'string') {
      throw new Error('Expected migrated openai apiKey to be a string')
    }
    expect(apiKeyValue.startsWith('enc:v1:')).toBe(true)
  })

  it('flags manual re-save when plaintext API key migration fails', async () => {
    mockState.encryptionAvailable = true
    mockState.encryptThrows = true
    mockState.storeData.providers = {
      openai: { apiKey: 'sk-plain', enabled: true, authMethod: 'api-key' },
    }

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
    const settings = getSettings()
    expect(settings.skillTogglesByProject).toEqual({
      '/tmp/repo': { 'code-review': true, 'frontend-design': false },
    })
  })
})

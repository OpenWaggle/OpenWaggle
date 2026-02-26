import { SupportedModelId } from '@shared/types/brand'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockState = vi.hoisted(() => ({
  fsExists: false,
  fsRaw: '',
  storeData: {} as Record<string, unknown>,
  setCalls: [] as Array<{ key: string; value: unknown }>,
  isKnownModel: vi.fn((modelId: string) => modelId === 'claude-sonnet-4-5'),
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
    isEncryptionAvailable: () => false,
    encryptString: (value: string) => Buffer.from(value, 'utf8'),
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
    private data: Record<string, unknown>

    constructor(options: { defaults?: Partial<T> }) {
      this.data = {
        ...(options.defaults ?? {}),
        ...mockState.storeData,
      }
    }

    get<K extends keyof T>(key: K, defaultValue?: T[K]): T[K] {
      if (key in this.data) {
        return this.data[key as string] as T[K]
      }
      return defaultValue as T[K]
    }

    set<K extends keyof T>(key: K, value: T[K]): void {
      this.data[key as string] = value
      mockState.storeData[key as string] = value
      mockState.setCalls.push({ key: key as string, value })
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

    const settings = getSettings()
    expect(settings.providers.openai?.authMethod).toBe('subscription')
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

import type { ProviderInfo, SupportedModelId } from '@shared/types/llm'
import {
  DEFAULT_SETTINGS,
  type ExecutionMode,
  type Provider,
  type ProviderConfig,
  type QualityPreset,
  type Settings,
} from '@shared/types/settings'
import { create } from 'zustand'
import { api } from '@/lib/ipc'

interface SettingsState {
  settings: Settings
  isLoaded: boolean
  testingProviders: Partial<Record<Provider, boolean>>
  testResults: Partial<Record<Provider, { success: boolean; error?: string } | null>>
  providerModels: ProviderInfo[]

  loadSettings: () => Promise<void>
  loadProviderModels: () => Promise<void>
  updateApiKey: (provider: Provider, apiKey: string) => Promise<void>
  toggleProvider: (provider: Provider, enabled: boolean) => Promise<void>
  updateBaseUrl: (provider: Provider, baseUrl: string) => Promise<void>
  setDefaultModel: (model: SupportedModelId) => Promise<void>
  setProjectPath: (path: string | null) => Promise<void>
  setExecutionMode: (mode: ExecutionMode) => Promise<void>
  setQualityPreset: (preset: QualityPreset) => Promise<void>
  pushRecentProject: (path: string) => Promise<void>
  testApiKey: (provider: Provider, apiKey: string, baseUrl?: string) => Promise<boolean>
  clearTestResult: (provider: Provider) => void
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  settings: DEFAULT_SETTINGS,
  isLoaded: false,
  testingProviders: {},
  testResults: {},
  providerModels: [],

  async loadSettings() {
    const settings = await api.getSettings()
    set({ settings, isLoaded: true })
  },

  async loadProviderModels() {
    const providerModels = await api.getProviderModels()
    set({ providerModels })
  },

  async updateApiKey(provider: Provider, apiKey: string) {
    const normalizedApiKey = apiKey.trim()

    const { settings } = get()
    const existing = settings.providers[provider]
    const updated: Settings = {
      ...settings,
      providers: {
        ...settings.providers,
        [provider]: {
          ...existing,
          apiKey: normalizedApiKey,
          enabled: normalizedApiKey ? (existing?.enabled ?? true) : false,
        } satisfies ProviderConfig,
      },
    }
    await api.updateSettings({ providers: updated.providers })
    set({ settings: updated })
  },

  async toggleProvider(provider: Provider, enabled: boolean) {
    const { settings } = get()
    const existing = settings.providers[provider]
    const updated: Settings = {
      ...settings,
      providers: {
        ...settings.providers,
        [provider]: {
          apiKey: existing?.apiKey ?? '',
          baseUrl: existing?.baseUrl,
          enabled,
        },
      },
    }
    await api.updateSettings({ providers: updated.providers })
    set({ settings: updated })
  },

  async updateBaseUrl(provider: Provider, baseUrl: string) {
    const normalizedBaseUrl = baseUrl.trim()
    if (normalizedBaseUrl && !isValidUrl(normalizedBaseUrl)) return

    const { settings } = get()
    const existing = settings.providers[provider]
    const updated: Settings = {
      ...settings,
      providers: {
        ...settings.providers,
        [provider]: {
          apiKey: existing?.apiKey ?? '',
          enabled: existing?.enabled ?? false,
          baseUrl: normalizedBaseUrl || undefined,
        },
      },
    }
    await api.updateSettings({ providers: updated.providers })
    set({ settings: updated })
  },

  async setDefaultModel(model: SupportedModelId) {
    const { settings } = get()
    await api.updateSettings({ defaultModel: model })
    set({ settings: { ...settings, defaultModel: model } })
  },

  async setProjectPath(path: string | null) {
    const { settings } = get()
    let recentProjects = settings.recentProjects
    if (path) {
      const deduped = [path, ...settings.recentProjects.filter((p) => p !== path)]
      recentProjects = deduped.slice(0, 10)
    }
    await api.updateSettings({ projectPath: path, recentProjects })
    set({ settings: { ...settings, projectPath: path, recentProjects } })
  },

  async setExecutionMode(mode: ExecutionMode) {
    const { settings } = get()
    await api.updateSettings({ executionMode: mode })
    set({ settings: { ...settings, executionMode: mode } })
  },

  async setQualityPreset(preset: QualityPreset) {
    const { settings } = get()
    await api.updateSettings({ qualityPreset: preset })
    set({ settings: { ...settings, qualityPreset: preset } })
  },

  async pushRecentProject(path: string) {
    const normalized = path.trim()
    if (!normalized) return

    const { settings } = get()
    const recentProjects = [
      normalized,
      ...settings.recentProjects.filter((p) => p !== normalized),
    ].slice(0, 10)
    await api.updateSettings({ recentProjects })
    set({ settings: { ...settings, recentProjects } })
  },

  async testApiKey(provider: Provider, apiKey: string, baseUrl?: string) {
    set((state) => ({
      testingProviders: { ...state.testingProviders, [provider]: true },
    }))
    try {
      const result = await api.testApiKey(provider, apiKey, baseUrl)
      set((state) => ({
        testResults: { ...state.testResults, [provider]: result },
        testingProviders: { ...state.testingProviders, [provider]: false },
      }))
      return result.success
    } catch {
      set((state) => ({
        testResults: {
          ...state.testResults,
          [provider]: { success: false, error: 'Unexpected error — check the console' },
        },
        testingProviders: { ...state.testingProviders, [provider]: false },
      }))
      return false
    }
  },

  clearTestResult(provider: Provider) {
    set((state) => ({
      testResults: { ...state.testResults, [provider]: null },
    }))
  },
}))

function isValidUrl(value: string): boolean {
  try {
    const parsed = new URL(value)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}

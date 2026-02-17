import type { SupportedModelId } from '@shared/types/llm'
import {
  DEFAULT_SETTINGS,
  type Provider,
  type ProviderConfig,
  type Settings,
} from '@shared/types/settings'
import { create } from 'zustand'
import { api } from '@/lib/ipc'

interface SettingsState {
  settings: Settings
  isLoaded: boolean
  isTestingKey: boolean
  testResults: Partial<Record<string, { success: boolean } | null>>

  loadSettings: () => Promise<void>
  updateApiKey: (provider: Provider, apiKey: string) => Promise<void>
  toggleProvider: (provider: Provider, enabled: boolean) => Promise<void>
  updateBaseUrl: (provider: Provider, baseUrl: string) => Promise<void>
  setDefaultModel: (model: SupportedModelId) => Promise<void>
  setProjectPath: (path: string | null) => Promise<void>
  testApiKey: (provider: Provider, apiKey: string, baseUrl?: string) => Promise<boolean>
  clearTestResult: (provider: Provider) => void
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  settings: DEFAULT_SETTINGS,
  isLoaded: false,
  isTestingKey: false,
  testResults: {},

  async loadSettings() {
    const settings = await api.getSettings()
    set({ settings, isLoaded: true })
  },

  async updateApiKey(provider: Provider, apiKey: string) {
    if (!apiKey.trim()) return

    const { settings } = get()
    const existing = settings.providers[provider]
    const updated: Settings = {
      ...settings,
      providers: {
        ...settings.providers,
        [provider]: {
          ...existing,
          apiKey,
          enabled: existing?.enabled ?? true,
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
    const { settings } = get()
    const existing = settings.providers[provider]
    const updated: Settings = {
      ...settings,
      providers: {
        ...settings.providers,
        [provider]: {
          apiKey: existing?.apiKey ?? '',
          enabled: existing?.enabled ?? false,
          baseUrl,
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
    await api.updateSettings({ projectPath: path })
    set({ settings: { ...settings, projectPath: path } })
  },

  async testApiKey(provider: Provider, apiKey: string, baseUrl?: string) {
    set({ isTestingKey: true })
    try {
      const success = await api.testApiKey(provider, apiKey, baseUrl)
      set((state) => ({
        testResults: { ...state.testResults, [provider]: { success } },
        isTestingKey: false,
      }))
      return success
    } catch {
      set((state) => ({
        testResults: { ...state.testResults, [provider]: { success: false } },
        isTestingKey: false,
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

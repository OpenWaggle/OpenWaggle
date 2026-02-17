import type { SupportedModelId } from '@shared/types/llm'
import { DEFAULT_SETTINGS, type Provider, type Settings } from '@shared/types/settings'
import { create } from 'zustand'
import { api } from '@/lib/ipc'

interface SettingsState {
  settings: Settings
  isLoaded: boolean
  isTestingKey: boolean
  testResult: { provider: Provider; success: boolean } | null

  loadSettings: () => Promise<void>
  updateApiKey: (provider: Provider, apiKey: string) => Promise<void>
  setDefaultModel: (model: SupportedModelId) => Promise<void>
  setProjectPath: (path: string | null) => Promise<void>
  testApiKey: (provider: Provider, apiKey: string) => Promise<boolean>
  clearTestResult: () => void
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  settings: DEFAULT_SETTINGS,
  isLoaded: false,
  isTestingKey: false,
  testResult: null,

  async loadSettings() {
    const settings = await api.getSettings()
    set({ settings, isLoaded: true })
  },

  async updateApiKey(provider: Provider, apiKey: string) {
    const { settings } = get()
    const updated: Settings = {
      ...settings,
      providers: {
        ...settings.providers,
        [provider]: { apiKey },
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

  async testApiKey(provider: Provider, apiKey: string) {
    set({ isTestingKey: true, testResult: null })
    try {
      const success = await api.testApiKey(provider, apiKey)
      set({ testResult: { provider, success }, isTestingKey: false })
      return success
    } catch {
      set({ testResult: { provider, success: false }, isTestingKey: false })
      return false
    }
  },

  clearTestResult() {
    set({ testResult: null })
  },
}))

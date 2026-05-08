import { SupportedModelId } from '@shared/types/brand'
import type { ProviderInfo } from '@shared/types/llm'
import { DEFAULT_SETTINGS, type Provider, type Settings } from '@shared/types/settings'
import { create } from 'zustand'
import { api } from '@/lib/ipc'
import { createRendererLogger } from '@/lib/logger'

const logger = createRendererLogger('provider-store')

/**
 * Build a set of canonical "provider/modelId" refs from the current Pi model catalog.
 * Used to validate enabledModels entries against what actually exists.
 */
/** @internal Exported for testing */
export function buildModelCatalogSet(providerModels: readonly ProviderInfo[]): Set<string> {
  const catalog = new Set<string>()
  for (const group of providerModels) {
    for (const model of group.models) {
      const trimmedId = model.id.trim()
      if (trimmedId) {
        catalog.add(trimmedId)
      }
    }
  }
  return catalog
}

function buildAvailableModelSet(providerModels: readonly ProviderInfo[]): Set<string> {
  const available = new Set<string>()
  for (const group of providerModels) {
    for (const model of group.models) {
      if (model.available) {
        available.add(model.id)
      }
    }
  }
  return available
}

/**
 * Remove enabledModels entries that reference models no longer in the provider
 * catalog (stale version suffixes, removed models, or providerless IDs).
 */
/** @internal Exported for testing */
export function pruneStaleEnabledModels(
  enabledModels: readonly string[],
  catalog: ReadonlySet<string>,
): SupportedModelId[] | null {
  const pruned: SupportedModelId[] = []
  let changed = false

  for (const key of enabledModels) {
    const normalized = key.trim()
    if (!catalog.has(normalized)) {
      changed = true
      continue
    }

    pruned.push(SupportedModelId(normalized))
  }

  return changed ? pruned : null
}

function dedupeProviderModels(
  provider: Provider,
  models: readonly ProviderInfo['models'][number][],
): ProviderInfo['models'] {
  const seen = new Set<string>()
  const deduped: ProviderInfo['models'] = []

  for (const model of models) {
    const normalizedId = model.id.trim()
    if (!normalizedId) continue

    if (seen.has(normalizedId)) continue
    seen.add(normalizedId)

    deduped.push({
      id: SupportedModelId(normalizedId),
      modelId: model.modelId,
      name: model.name,
      provider,
      available: model.available,
      availableThinkingLevels: model.availableThinkingLevels,
      contextWindow: model.contextWindow,
    })
  }

  return deduped
}

function normalizeProviderGroups(providerModels: readonly ProviderInfo[]): ProviderInfo[] {
  return providerModels.map((group) => ({
    ...group,
    models: dedupeProviderModels(group.provider, group.models),
  }))
}

interface ProviderState {
  baseProviderModels: ProviderInfo[]
  providerModels: ProviderInfo[]
  testingProviders: Partial<Record<Provider, boolean>>
  testResults: Partial<Record<Provider, { success: boolean; error?: string } | null>>
  loadError: string | null

  loadProviderModels: (settingsSnapshot?: Settings) => Promise<Settings | null>
  updateApiKey: (provider: Provider, apiKey: string) => Promise<void>
  testApiKey: (provider: Provider, apiKey: string) => Promise<boolean>
  clearTestResult: (provider: Provider) => void
}

export const useProviderStore = create<ProviderState>((set) => ({
  baseProviderModels: [],
  providerModels: [],
  testingProviders: {},
  testResults: {},
  loadError: null,

  async loadProviderModels(settingsSnapshot?: Settings) {
    try {
      const currentSettings = settingsSnapshot ?? (await api.getSettings())
      const baseProviderModels = normalizeProviderGroups(
        await api.getProviderModels(currentSettings.projectPath),
      )
      set({ baseProviderModels, providerModels: baseProviderModels, loadError: null })
      const catalog = buildModelCatalogSet(baseProviderModels)
      const available = buildAvailableModelSet(baseProviderModels)
      const pruned = pruneStaleEnabledModels(currentSettings.enabledModels, catalog)
      const enabledModels = pruned ?? currentSettings.enabledModels
      const selectedModel =
        currentSettings.selectedModel &&
        enabledModels.includes(currentSettings.selectedModel) &&
        available.has(currentSettings.selectedModel)
          ? currentSettings.selectedModel
          : (enabledModels.find((modelRef) => available.has(modelRef)) ??
            DEFAULT_SETTINGS.selectedModel)

      if (pruned !== null || selectedModel !== currentSettings.selectedModel) {
        const modelSettings = { enabledModels, selectedModel }
        await api.updateSettings(modelSettings)
        return { ...currentSettings, ...modelSettings }
      }
      return null
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      logger.error('Failed to load provider models', { message })
      set({ loadError: message })
      return null
    }
  },

  async updateApiKey(provider: Provider, apiKey: string) {
    const normalizedApiKey = apiKey.trim()
    await api.setProviderApiKey(provider, normalizedApiKey)
    await useProviderStore.getState().loadProviderModels()
  },

  async testApiKey(provider: Provider, apiKey: string) {
    set((state) => ({
      testingProviders: { ...state.testingProviders, [provider]: true },
    }))
    try {
      const currentSettings = await api.getSettings()
      const result = await api.testApiKey(provider, apiKey, currentSettings.projectPath)
      set((state) => ({
        testResults: { ...state.testResults, [provider]: result },
        testingProviders: { ...state.testingProviders, [provider]: false },
      }))
      return result.success
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      logger.error('Failed to test provider API key', { provider, message })
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

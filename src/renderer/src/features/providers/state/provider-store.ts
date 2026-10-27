import { SupportedModelId } from '@shared/types/brand'
import type { ProviderCatalogScope, ProviderInfo } from '@shared/types/llm'
import { parseModelRef } from '@shared/types/llm'
import { DEFAULT_SETTINGS, type Provider, type Settings } from '@shared/types/settings'
import { create } from 'zustand'
import { api } from '@/shared/lib/ipc'
import { createRendererLogger } from '@/shared/lib/logger'

const logger = createRendererLogger('provider-store')

function buildAvailableModelSet(providerModels: readonly ProviderInfo[]) {
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

/** The first of `models` the catalog lists and can run. */
export function firstRunnableModel(
  providerModels: readonly ProviderInfo[],
  models: readonly SupportedModelId[],
) {
  const available = buildAvailableModelSet(providerModels)
  return models.find((model) => available.has(model))
}

/**
 * Whether the stored selection may stay. Enabled models a catalog does not list stay enabled and
 * are only not shown, since enabledModels holds every project's choices. The selection is
 * project-scoped work, though:
 * - one the catalog lists must be enabled and available;
 * - a project's catalog lists everything that project can run, so one it lacks is unusable there;
 * - without a project, one the catalog lacks may be another project's extension or virtual model,
 *   unless the catalog lists its provider but not the model: Pi dropped that model (0.x ids).
 */
function selectionUsable(
  providerModels: readonly ProviderInfo[],
  settings: Pick<Settings, 'enabledModels' | 'selectedModel' | 'projectPath'>,
) {
  const selected = settings.selectedModel
  if (!selected) return false
  const listed = catalogModel(providerModels, selected)
  if (listed) return listed.available && settings.enabledModels.includes(selected)
  if (settings.projectPath) return false
  const provider = parseModelRef(selected)?.provider
  return !providerModels.some((group) => group.provider === provider)
}

/** The model of a Session's latest response, which a gone selection's Runs fall back to. */
export function latestAnsweringModel(
  messages: readonly { readonly role: string; readonly model?: SupportedModelId }[],
) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message?.role === 'assistant' && message.model) return message.model
  }
  return undefined
}

/**
 * Whether a Session can run on `model`: Pi has it and can sign in to its provider. Enabled models
 * only decide what the picker offers. A Session continued from the `pi` CLI keeps its own model,
 * as `pi --resume` does, though the user never enabled it in OpenWaggle. A Session whose model is
 * gone from the catalog, such as a removed virtual model, can still send while the model that
 * answered last is available: the Run falls back to it and says so. Before the catalog has
 * hydrated, the model is left as-is rather than gated during startup.
 */
export function isSelectableModel(
  providerModels: readonly ProviderInfo[],
  model: SupportedModelId | undefined,
  catalogHydrated: boolean,
  lastAnsweringModel?: SupportedModelId,
): model is SupportedModelId {
  if (!model) return false
  if (!catalogHydrated) return true
  const listed = catalogModel(providerModels, model)
  if (listed) return listed.available
  return (
    lastAnsweringModel !== undefined &&
    catalogModel(providerModels, lastAnsweringModel)?.available === true
  )
}

/** Why the live catalog cannot run `model`, as an error to show, or undefined when it can. */
export function modelActionError(
  model: SupportedModelId | undefined,
  lastAnsweringModel?: SupportedModelId,
) {
  if (isModelActionable(model, lastAnsweringModel)) return undefined
  return new Error(modelUnavailableMessage(useProviderStore.getState().providerModels, model))
}

/** Catalog check against the live provider store. */
export function isModelActionable(
  model: SupportedModelId | undefined,
  lastAnsweringModel?: SupportedModelId,
): model is SupportedModelId {
  const state = useProviderStore.getState()
  return isSelectableModel(state.providerModels, model, state.catalogHydrated, lastAnsweringModel)
}

function catalogModel(providerModels: readonly ProviderInfo[], model: SupportedModelId) {
  for (const group of providerModels) {
    const found = group.models.find((candidate) => candidate.id === model)
    if (found) return { ...found, providerName: group.displayName }
  }
  return undefined
}

/** Why a Session cannot run on `model`, and what the user can do about it. */
export function modelUnavailableMessage(
  providerModels: readonly ProviderInfo[],
  model: SupportedModelId | undefined,
) {
  if (!model) return 'Select a model before sending.'
  const found = catalogModel(providerModels, model)
  if (!found) {
    return `${model} is not available in this project. Add its provider in Settings > Connections, or choose another model.`
  }
  return `${found.name} needs a sign-in to ${found.providerName}. Connect ${found.providerName} in Settings > Connections, or choose another model.`
}

function dedupeProviderModels(
  provider: Provider,
  models: readonly ProviderInfo['models'][number][],
) {
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
      ...(model.virtual ? { virtual: true } : {}),
    })
  }

  return deduped
}

function normalizeProviderGroups(providerModels: readonly ProviderInfo[]) {
  return providerModels.map((group) => ({
    ...group,
    models: dedupeProviderModels(group.provider, group.models),
  }))
}

/** Settles older catalog loads after a newer one started, so a slow startup load cannot win. */
let latestCatalogLoad = 0

interface ProviderState {
  baseProviderModels: ProviderInfo[]
  providerModels: ProviderInfo[]
  /**
   * Which catalog the store holds and reloads. Startup loads `available`, every provider with only
   * its runnable models, which is all the composer offers; Settings asks for `all` once, and later
   * reloads keep it (renderer-load B14).
   */
  catalogScope: ProviderCatalogScope
  /** True once loadProviderModels settled, even with zero providers — separates "empty" from "not loaded yet". */
  catalogHydrated: boolean
  isLoading: boolean
  testingProviders: Partial<Record<Provider, boolean>>
  testResults: Partial<Record<Provider, { success: boolean; error?: string } | null>>
  loadError: string | null

  loadProviderModels: (settingsSnapshot?: Settings) => Promise<Settings | null>
  /** Loads every provider's full model list unless the store already holds it. */
  ensureFullProviderCatalog: () => Promise<void>
  updateApiKey: (provider: Provider, apiKey: string) => Promise<void>
  testApiKey: (provider: Provider, apiKey: string) => Promise<boolean>
  clearTestResult: (provider: Provider) => void
}

export const useProviderStore = create<ProviderState>((set, get) => ({
  baseProviderModels: [],
  providerModels: [],
  catalogScope: 'available',
  catalogHydrated: false,
  isLoading: false,
  testingProviders: {},
  testResults: {},
  loadError: null,

  async loadProviderModels(settingsSnapshot?: Settings) {
    latestCatalogLoad += 1
    const load = latestCatalogLoad
    const scope = get().catalogScope
    set({ isLoading: true, loadError: null })
    try {
      const currentSettings = settingsSnapshot ?? (await api.getSettings())
      const baseProviderModels = normalizeProviderGroups(
        await api.getProviderModels(currentSettings.projectPath, scope),
      )
      // A newer load (another project, or Settings asking for the full catalog) replaces this one.
      if (load !== latestCatalogLoad) return null
      set({
        baseProviderModels,
        providerModels: baseProviderModels,
        loadError: null,
        catalogHydrated: true,
      })
      if (baseProviderModels.length === 0) {
        return null
      }
      const { enabledModels, selectedModel: selected } = currentSettings
      if (selectionUsable(baseProviderModels, currentSettings)) return null
      const selectedModel =
        firstRunnableModel(baseProviderModels, enabledModels) ?? DEFAULT_SETTINGS.selectedModel
      if (selectedModel === selected) return null
      await api.updateSettings({ selectedModel })
      return { ...currentSettings, selectedModel }
    } catch (error) {
      if (load !== latestCatalogLoad) return null
      const message = error instanceof Error ? error.message : String(error)
      logger.error('Failed to load provider models', { message })
      set({ loadError: message, catalogHydrated: true })
      return null
    } finally {
      if (load === latestCatalogLoad) set({ isLoading: false })
    }
  },

  async ensureFullProviderCatalog() {
    const state = get()
    if (state.catalogScope === 'all' && state.catalogHydrated && state.loadError === null) return
    set({ catalogScope: 'all' })
    await get().loadProviderModels()
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

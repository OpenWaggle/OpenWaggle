import { SupportedModelId } from '@shared/types/brand'
import type { ProviderCatalogScope, ProviderInfo } from '@shared/types/llm'
import { generateDisplayName, parseModelRef } from '@shared/types/llm'
import type { Provider, Settings } from '@shared/types/settings'
import { create } from 'zustand'
import type { ProviderRestrictionScope } from '@shared/utils/provider-restriction'
import {
  catalogModel,
  type ProjectSelectionReconciler,
  selectionAfterRestriction,
} from './project-model-selection'
import { api } from '@/shared/lib/ipc'
import { createRendererLogger } from '@/shared/lib/logger'

const logger = createRendererLogger('provider-store')

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

function signInMessage(modelName: string, providerName: string) {
  return `${modelName} needs a sign-in to ${providerName}. Connect ${providerName} in Settings > Connections, or choose another model.`
}

/**
 * Why a Session cannot run on `model`, and what the user can do about it. The startup catalog
 * (`available` scope) lists every provider but only the models that can run, so a signed-out
 * provider's model is missing from it while its provider, with its sign-in state, is listed.
 */
export function modelUnavailableMessage(
  providerModels: readonly ProviderInfo[],
  model: SupportedModelId | undefined,
) {
  if (!model) return 'Select a model before sending.'
  const found = catalogModel(providerModels, model)
  if (found) return signInMessage(found.name, found.providerName)
  const ref = parseModelRef(model)
  const provider = providerModels.find((group) => group.provider === ref?.provider)
  if (ref && provider && !provider.auth.configured) {
    return signInMessage(generateDisplayName(ref.modelId), provider.displayName)
  }
  if (provider) {
    return `${model} is not available from ${provider.displayName}. Choose another model.`
  }
  return `${model} is not available in this project. Add its provider in Settings > Connections, or choose another model.`
}

function dedupeProviderModels(
  provider: Provider,
  models: readonly ProviderInfo['models'][number][],
) {
  const seen = new Set<string>()
  const deduped: ProviderInfo['models'][number][] = []

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
      ...(model.contextWindow === undefined ? {} : { contextWindow: model.contextWindow }),
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
  /** The opened project's own settings-file restriction scope, refreshed on project open. */
  projectProviderOverride: ProviderRestrictionScope | undefined
  setProjectProviderOverride: (override: ProviderRestrictionScope | undefined) => void
  /** Moves a disallowed selection back inside the project's restriction; resolves to the replacement. */
  reconcileProjectSelection: ProjectSelectionReconciler

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
  projectProviderOverride: undefined,

  setProjectProviderOverride: (override) => set({ projectProviderOverride: override }),

  reconcileProjectSelection: async (settings) => {
    const next = selectionAfterRestriction(
      get().providerModels,
      settings,
      get().projectProviderOverride,
    )
    if (next === null) return null
    await api.updateSettings({ selectedModel: next.selectedModel })
    return next.selectedModel
  },

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
      // A provider restriction moves a disallowed selection back inside the project first: the
      // composer names its model at launch, so its pick must already be one the project allows.
      const next = selectionAfterRestriction(
        baseProviderModels,
        currentSettings,
        get().projectProviderOverride,
      )
      if (next === null) return null
      await api.updateSettings({ selectedModel: next.selectedModel })
      return { ...currentSettings, ...next }
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

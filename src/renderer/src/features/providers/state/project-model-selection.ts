import type { SupportedModelId } from '@shared/types/brand'
import { type ProviderInfo, parseModelRef } from '@shared/types/llm'
import { DEFAULT_SETTINGS, type Settings } from '@shared/types/settings'
import {
  type ProviderRestrictionScope,
  type ResolvedProviderRestriction,
  resolveProviderRestriction,
} from '@shared/utils/provider-restriction'

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
export function selectionUsable(
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

export function catalogModel(providerModels: readonly ProviderInfo[], model: SupportedModelId) {
  for (const group of providerModels) {
    const found = group.models.find((candidate) => candidate.id === model)
    if (found) return { ...found, providerName: group.displayName }
  }
  return undefined
}

/**
 * The project's effective provider restriction, or null without a project: the app-wide choice
 * narrowed by the path scopes containing the project and the project file's own scope.
 */
export function resolveProjectProviderRestriction(
  settings: Settings,
  projectProviderOverride?: ProviderRestrictionScope,
) {
  if (!settings.projectPath) return null
  return resolveProviderRestriction({
    projectPath: settings.projectPath,
    byPath: settings.providerRestrictionsByPath,
    ...(projectProviderOverride !== undefined ? { projectOverride: projectProviderOverride } : {}),
    appWide: settings.providerRestrictions,
    ...(settings.projectPathAliases ? { aliases: settings.projectPathAliases } : {}),
  })
}

/** The enabled models whose provider a restriction allows. */
export function enabledModelsWithinRestriction(
  enabledModels: readonly SupportedModelId[],
  restriction: ResolvedProviderRestriction,
) {
  return enabledModels.filter((model) => {
    const parsed = parseModelRef(model)
    return parsed !== null && restriction.allows(parsed.provider)
  })
}

/**
 * The first catalog-runnable enabled model of a provider the project allows, when the selection
 * uses a provider it does not. Null when the selection stands or nothing runnable replaces it:
 * the picker then explains, and a send that names the disallowed model fails visibly.
 */
export function runnableModelWithinRestriction(
  providerModels: readonly ProviderInfo[],
  settings: Settings,
  restriction: ResolvedProviderRestriction,
) {
  const selected = parseModelRef(settings.selectedModel)
  if (!selected || restriction.allows(selected.provider)) return null
  return (
    firstRunnableModel(
      providerModels,
      enabledModelsWithinRestriction(settings.enabledModels, restriction),
    ) ?? null
  )
}

/** The store action that moves a disallowed selection back inside the project's restriction. */
export type ProjectSelectionReconciler = (settings: Settings) => Promise<SupportedModelId | null>

/**
 * The selection a project's provider restriction leaves after a catalog load: null when the
 * current selection stands, else the model to store in its place. The composer names its model at
 * launch, so its pick must already be one the project allows; the unusable-selection fallback
 * stays inside the restriction too.
 */
export function selectionAfterRestriction(
  providerModels: readonly ProviderInfo[],
  settings: Settings,
  projectProviderOverride: ProviderRestrictionScope | undefined,
) {
  const restriction = resolveProjectProviderRestriction(settings, projectProviderOverride)
  if (restriction) {
    const within = runnableModelWithinRestriction(providerModels, settings, restriction)
    if (within !== null) {
      return within === settings.selectedModel ? null : { selectedModel: within }
    }
  }
  if (selectionUsable(providerModels, settings)) return null
  const effectiveEnabled = restriction
    ? enabledModelsWithinRestriction(settings.enabledModels, restriction)
    : settings.enabledModels
  const selectedModel =
    firstRunnableModel(providerModels, effectiveEnabled) ?? DEFAULT_SETTINGS.selectedModel
  return selectedModel === settings.selectedModel ? null : { selectedModel }
}

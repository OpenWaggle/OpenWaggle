import type { ModelDisplayInfo, SupportedModelId } from '@shared/types/llm'
import type { ThinkingLevel } from '@shared/types/settings'
import { clampThinkingLevel } from '@shared/utils/thinking-levels'
import { usePreferencesStore } from '@/stores/preferences-store'
import { useProviderStore } from '@/stores/provider-store'

interface SelectedModelThinkingLevelInput {
  readonly providerModels: readonly {
    readonly models: readonly ModelDisplayInfo[]
  }[]
  readonly selectedModel: SupportedModelId
  readonly requestedThinkingLevel: ThinkingLevel
}

interface SelectedModelThinkingLevel {
  readonly requestedThinkingLevel: ThinkingLevel
  readonly effectiveThinkingLevel: ThinkingLevel
  readonly availableThinkingLevels: readonly ThinkingLevel[]
  readonly capabilitiesKnown: boolean
  readonly isAdjustedForModel: boolean
}

function findSelectedModel(
  providerModels: SelectedModelThinkingLevelInput['providerModels'],
  selectedModel: SupportedModelId,
): ModelDisplayInfo | null {
  const selectedModelId = selectedModel.trim()
  if (!selectedModelId) {
    return null
  }

  for (const provider of providerModels) {
    const model = provider.models.find((candidate) => candidate.id === selectedModelId)
    if (model) {
      return model
    }
  }

  return null
}

export function resolveSelectedModelThinkingLevel(
  input: SelectedModelThinkingLevelInput,
): SelectedModelThinkingLevel {
  const model = findSelectedModel(input.providerModels, input.selectedModel)
  if (!model) {
    return {
      requestedThinkingLevel: input.requestedThinkingLevel,
      effectiveThinkingLevel: input.requestedThinkingLevel,
      availableThinkingLevels: [],
      capabilitiesKnown: false,
      isAdjustedForModel: false,
    }
  }

  const effectiveThinkingLevel = clampThinkingLevel(
    input.requestedThinkingLevel,
    model.availableThinkingLevels,
  )

  return {
    requestedThinkingLevel: input.requestedThinkingLevel,
    effectiveThinkingLevel,
    availableThinkingLevels: model.availableThinkingLevels,
    capabilitiesKnown: true,
    isAdjustedForModel: effectiveThinkingLevel !== input.requestedThinkingLevel,
  }
}

export function useSelectedModelThinkingLevel(): SelectedModelThinkingLevel {
  const selectedModel = usePreferencesStore((state) => state.settings.selectedModel)
  const requestedThinkingLevel = usePreferencesStore((state) => state.settings.thinkingLevel)
  const providerModels = useProviderStore((state) => state.providerModels)

  return resolveSelectedModelThinkingLevel({
    providerModels,
    selectedModel,
    requestedThinkingLevel,
  })
}

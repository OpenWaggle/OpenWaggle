import { clampThinkingLevel } from '@shared/utils/thinking-levels';
import { useProviderStore } from '@/features/providers/state/provider-store';
import { usePreferencesStore } from '@/features/settings/state';
function findSelectedModel(providerModels, selectedModel) {
    const selectedModelId = selectedModel.trim();
    if (!selectedModelId) {
        return null;
    }
    for (const provider of providerModels) {
        const model = provider.models.find((candidate) => candidate.id === selectedModelId);
        if (model) {
            return model;
        }
    }
    return null;
}
export function resolveSelectedModelThinkingLevel(input) {
    const model = findSelectedModel(input.providerModels, input.selectedModel);
    if (!model) {
        return {
            requestedThinkingLevel: input.requestedThinkingLevel,
            effectiveThinkingLevel: input.requestedThinkingLevel,
            availableThinkingLevels: [],
            capabilitiesKnown: false,
            isAdjustedForModel: false,
        };
    }
    const effectiveThinkingLevel = clampThinkingLevel(input.requestedThinkingLevel, model.availableThinkingLevels);
    return {
        requestedThinkingLevel: input.requestedThinkingLevel,
        effectiveThinkingLevel,
        availableThinkingLevels: model.availableThinkingLevels,
        capabilitiesKnown: true,
        isAdjustedForModel: effectiveThinkingLevel !== input.requestedThinkingLevel,
    };
}
export function useSelectedModelThinkingLevel() {
    const selectedModel = usePreferencesStore((state) => state.settings.selectedModel);
    const requestedThinkingLevel = usePreferencesStore((state) => state.settings.thinkingLevel);
    const providerModels = useProviderStore((state) => state.providerModels);
    return resolveSelectedModelThinkingLevel({
        providerModels,
        selectedModel,
        requestedThinkingLevel,
    });
}

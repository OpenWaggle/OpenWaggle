import type { ModelDisplayInfo, SupportedModelId } from '@shared/types/llm';
import type { ThinkingLevel } from '@shared/types/settings';
interface SelectedModelThinkingLevelInput {
    readonly providerModels: readonly {
        readonly models: readonly ModelDisplayInfo[];
    }[];
    readonly selectedModel: SupportedModelId;
    readonly requestedThinkingLevel: ThinkingLevel;
}
interface SelectedModelThinkingLevel {
    readonly requestedThinkingLevel: ThinkingLevel;
    readonly effectiveThinkingLevel: ThinkingLevel;
    readonly availableThinkingLevels: readonly ThinkingLevel[];
    readonly capabilitiesKnown: boolean;
    readonly isAdjustedForModel: boolean;
}
export declare function resolveSelectedModelThinkingLevel(input: SelectedModelThinkingLevelInput): SelectedModelThinkingLevel;
export declare function useSelectedModelThinkingLevel(): SelectedModelThinkingLevel;
export {};

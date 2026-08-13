import type { ThinkingLevel } from '@shared/types/settings';
interface ThinkingLevelTitleInput {
    readonly hasSelectedModel: boolean;
    readonly capabilitiesKnown: boolean;
    readonly selectedModelOnlySupportsOff: boolean;
    readonly isAdjustedForModel: boolean;
    readonly requestedThinkingLevel: ThinkingLevel;
    readonly effectiveThinkingLevel: ThinkingLevel;
}
export declare function hasOnlyOffThinkingLevel(levels: readonly ThinkingLevel[]): boolean;
export declare function getThinkingButtonLabel(hasSelectedModel: boolean, capabilitiesKnown: boolean, effectiveThinkingLevel: ThinkingLevel): string;
export declare function getThinkingButtonTitle({ hasSelectedModel, capabilitiesKnown, selectedModelOnlySupportsOff, isAdjustedForModel, requestedThinkingLevel, effectiveThinkingLevel, }: ThinkingLevelTitleInput): string;
export {};

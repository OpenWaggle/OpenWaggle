import type { ComposerGet, ComposerSet } from './composer-store-types';
export declare const PROMPT_HISTORY_MAX = 100;
export declare function loadPromptHistory(): string[];
export declare function createHistoryActions(set: ComposerSet, get: ComposerGet): {
    pushHistory(text: string): void;
    historyUp(currentInput: string): string | null;
    historyDown(): string | null;
};

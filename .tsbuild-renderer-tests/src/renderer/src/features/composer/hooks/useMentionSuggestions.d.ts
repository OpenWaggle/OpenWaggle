import type { FileSuggestion } from '@shared/types/composer';
interface UseMentionSuggestionsInput {
    readonly projectPath: string | null;
    readonly query: string | null;
}
export declare function useMentionSuggestions({ projectPath, query }: UseMentionSuggestionsInput): {
    suggestions: FileSuggestion[];
    highlightIndex: number;
    setHighlightIndex: import("node_modules/@types/react").Dispatch<import("node_modules/@types/react").SetStateAction<number>>;
    clearSuggestions: () => void;
};
export {};

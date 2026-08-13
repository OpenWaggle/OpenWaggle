import type { FileSuggestion } from '@shared/types/composer';
import { type LexicalEditor } from 'lexical';
interface UseMentionKeyboardInput {
    readonly editor: LexicalEditor;
    readonly isOpen: boolean;
    readonly suggestions: readonly FileSuggestion[];
    readonly highlightIndex: number;
    readonly setHighlightIndex: (updater: (currentIndex: number) => number) => void;
    readonly onSelect: (item: FileSuggestion) => void;
    readonly onClose: () => void;
}
export declare function useMentionKeyboard({ editor, isOpen, suggestions, highlightIndex, setHighlightIndex, onSelect, onClose, }: UseMentionKeyboardInput): void;
export {};

import type { FileSuggestion } from '@shared/types/composer';
interface MentionTypeaheadDropdownProps {
    items: FileSuggestion[];
    highlightIndex: number;
    position: {
        top: number;
        left: number;
    };
    onSelect: (item: FileSuggestion) => void;
    onClose: () => void;
}
export declare function MentionTypeaheadDropdown({ items, highlightIndex, position, onSelect, onClose, }: MentionTypeaheadDropdownProps): import("node_modules/@types/react").ReactPortal | null;
export {};

import type { FileSuggestion } from '@shared/types/composer';
import { type LexicalEditor } from 'lexical';
import type { MentionMatch } from '../lib/mention-match';
interface UseMentionSelectionInput {
    readonly editor: LexicalEditor;
    readonly match: MentionMatch | null;
    readonly onClose: () => void;
}
/**
 * Returns the mention-commit handler. Deliberately a plain function, not a
 * useEffectEvent: the result is passed as a prop to the dropdown (and to the
 * keyboard hook), and useEffectEvent results must only be called from Effects in
 * the component that created them (react-doctor/rules-of-hooks).
 */
export declare function useMentionSelection({ editor, match, onClose }: UseMentionSelectionInput): (item: FileSuggestion) => void;
export {};

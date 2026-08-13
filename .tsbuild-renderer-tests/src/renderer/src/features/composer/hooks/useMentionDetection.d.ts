import { type LexicalEditor } from 'lexical';
import { type MentionMatch } from '../lib/mention-match';
export declare function useMentionDetection(editor: LexicalEditor): {
    match: MentionMatch | null;
    position: {
        top: number;
        left: number;
    };
    clearMatch: () => void;
};

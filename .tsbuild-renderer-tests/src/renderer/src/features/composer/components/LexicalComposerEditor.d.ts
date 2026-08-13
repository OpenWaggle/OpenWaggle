import type { LexicalEditor } from 'lexical';
import type { RefObject } from 'react';
interface LexicalComposerEditorProps {
    onSubmit: (text: string) => void;
    disabled?: boolean;
    placeholder: string;
    editorRef: RefObject<LexicalEditor | null>;
    checkAndConvertPaste: (pastedText: string, currentEditorText: string) => boolean;
}
export declare function LexicalComposerEditor({ onSubmit, disabled, placeholder, editorRef, checkAndConvertPaste, }: LexicalComposerEditorProps): import("node_modules/@types/react").JSX.Element;
export {};

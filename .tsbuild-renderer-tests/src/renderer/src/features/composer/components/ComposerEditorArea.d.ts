import type { LexicalEditor } from 'lexical';
import type { RefObject } from 'react';
interface ComposerEditorAreaProps {
    readonly onSubmit: (text?: string) => void;
    readonly disabled?: boolean;
    readonly placeholder?: string;
    readonly isLoading: boolean;
    readonly editorRef: RefObject<LexicalEditor | null>;
    readonly checkAndConvertPaste: (pastedText: string, currentEditorText: string) => boolean;
}
export declare function ComposerEditorArea({ onSubmit, disabled, placeholder, isLoading, editorRef, checkAndConvertPaste, }: ComposerEditorAreaProps): import("node_modules/@types/react").JSX.Element;
export {};

import type { LexicalEditor } from 'lexical';
import { type RefObject } from 'react';
interface EditorRefPluginProps {
    editorRef: RefObject<LexicalEditor | null>;
}
/**
 * Exposes the Lexical editor instance via a ref for programmatic access
 * (voice insertion, history navigation, skill/mention insertion, etc.)
 * Also stores the editor in the composer Zustand store for cross-component access.
 */
export declare function EditorRefPlugin({ editorRef }: EditorRefPluginProps): null;
export {};

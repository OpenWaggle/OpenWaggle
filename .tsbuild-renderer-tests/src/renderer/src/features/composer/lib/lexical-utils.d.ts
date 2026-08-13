import { type LexicalEditor } from 'lexical';
/**
 * Replace all editor content with the given text and move cursor to end.
 */
export declare function setEditorText(editor: LexicalEditor, text: string): void;
/**
 * Clear all editor content.
 */
export declare function clearEditor(editor: LexicalEditor): void;

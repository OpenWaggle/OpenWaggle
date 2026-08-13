import { $createParagraphNode, $createTextNode, $getRoot } from 'lexical';
/**
 * Replace all editor content with the given text and move cursor to end.
 */
export function setEditorText(editor, text) {
    editor.update(() => {
        const root = $getRoot();
        root.clear();
        const paragraph = $createParagraphNode();
        if (text) {
            paragraph.append($createTextNode(text));
        }
        root.append(paragraph);
        root.selectEnd();
    });
}
/**
 * Clear all editor content.
 */
export function clearEditor(editor) {
    setEditorText(editor, '');
}

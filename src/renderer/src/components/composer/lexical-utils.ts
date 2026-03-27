import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $isElementNode,
  type LexicalEditor,
} from 'lexical'

/**
 * Replace all editor content with the given text and move cursor to end.
 */
export function setEditorText(editor: LexicalEditor, text: string): void {
  editor.update(() => {
    const root = $getRoot()
    root.clear()
    const paragraph = $createParagraphNode()
    if (text) {
      paragraph.append($createTextNode(text))
    }
    root.append(paragraph)
    root.selectEnd()
  })
}

/**
 * Get the current plain text content of the editor.
 */
export function getEditorText(editor: LexicalEditor): string {
  return editor.getEditorState().read(() => $getRoot().getTextContent())
}

/**
 * Clear all editor content.
 */
export function clearEditor(editor: LexicalEditor): void {
  setEditorText(editor, '')
}

/**
 * Insert text at the end of the editor, ensuring a paragraph container exists.
 */
export function appendText(editor: LexicalEditor, text: string): void {
  editor.update(() => {
    const root = $getRoot()
    const lastChild = root.getLastChild()
    const paragraph = lastChild && $isElementNode(lastChild) ? lastChild : $createParagraphNode()
    if (!lastChild || !$isElementNode(lastChild)) {
      root.append(paragraph)
    }
    paragraph.append($createTextNode(text))
    root.selectEnd()
  })
}

import type { WagglePreset } from '@shared/types/waggle'
import { $createParagraphNode, $createTextNode, $getRoot, type LexicalEditor } from 'lexical'
import { $createWaggleMentionNode } from '../components/nodes/WaggleMentionNode'

/**
 * Replace all editor content with the given text and move cursor to end.
 */
export function setEditorText(editor: LexicalEditor, text: string): void {
  setEditorDraft(editor, text, null)
}

export function setEditorDraft(
  editor: LexicalEditor,
  text: string,
  wagglePreset: WagglePreset | null,
): void {
  editor.update(() => {
    const root = $getRoot()
    root.clear()
    const paragraph = $createParagraphNode()
    if (text) {
      paragraph.append($createTextNode(text))
    }
    if (wagglePreset) {
      if (text && !text.endsWith(' ')) paragraph.append($createTextNode(' '))
      paragraph.append($createWaggleMentionNode(wagglePreset))
      paragraph.append($createTextNode(' '))
    }
    root.append(paragraph)
    root.selectEnd()
  })
}

/**
 * Clear all editor content.
 */
export function clearEditor(editor: LexicalEditor): void {
  setEditorText(editor, '')
}

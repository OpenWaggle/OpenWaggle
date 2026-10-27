import type { WagglePreset } from '@shared/types/waggle'
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  type LexicalEditor,
  SKIP_SCROLL_INTO_VIEW_TAG,
} from 'lexical'
import { $createWaggleMentionNode } from '../components/nodes/WaggleMentionNode'

/**
 * Replace all editor content with the given text and move cursor to end.
 */
export function setEditorText(editor: LexicalEditor, text: string): void {
  setEditorDraft(editor, text, null)
}

interface SetEditorDraftOptions {
  /**
   * Whether Lexical scrolls the caret into view after the update. Restoring a draft when the
   * composer mounts or switches Sessions does not move the caret anywhere the person is looking;
   * the scroll check alone reads the bounding box of every ancestor and forces a layout of the
   * freshly committed shell (renderer-load B12).
   */
  readonly scrollIntoView?: boolean
}

export function setEditorDraft(
  editor: LexicalEditor,
  text: string,
  wagglePreset: WagglePreset | null,
  { scrollIntoView = true }: SetEditorDraftOptions = {},
): void {
  editor.update(
    () => {
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
    },
    scrollIntoView ? { discrete: true } : { discrete: true, tag: SKIP_SCROLL_INTO_VIEW_TAG },
  )
}

/**
 * Clear all editor content.
 */
export function clearEditor(editor: LexicalEditor): void {
  setEditorText(editor, '')
}

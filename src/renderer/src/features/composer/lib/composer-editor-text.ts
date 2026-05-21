import type { LexicalEditor } from 'lexical'
import { $createParagraphNode, $createTextNode, $getRoot, $isElementNode } from 'lexical'
import { useComposerStore } from '../state/composer-store'

export function insertTextAtEditorOrStore(
  editor: LexicalEditor | null,
  text: string,
  setInput: (value: string) => void,
) {
  if (!editor) {
    const store = useComposerStore.getState()
    setInput(store.input + text)
    return
  }

  editor.update(() => {
    const root = $getRoot()
    root.selectEnd()
    const lastChild = root.getLastChild()
    const paragraph = lastChild && $isElementNode(lastChild) ? lastChild : $createParagraphNode()
    if (!lastChild || !$isElementNode(lastChild)) {
      root.append(paragraph)
    }
    paragraph.append($createTextNode(text))
    root.selectEnd()
  })
}

import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import type { LexicalEditor } from 'lexical'
import { type RefObject, useLayoutEffect } from 'react'
import { setEditorDraft } from '@/features/composer/lib/lexical-utils'
import { useComposerStore } from '@/features/composer/state/composer-store'

interface EditorRefPluginProps {
  editorRef: RefObject<LexicalEditor | null>
}

/**
 * Exposes the Lexical editor instance via a ref for programmatic access
 * (voice insertion, history navigation, skill/mention insertion, etc.)
 * Also stores the editor in the composer Zustand store for cross-component access.
 */
export function EditorRefPlugin({ editorRef }: EditorRefPluginProps): null {
  const [editor] = useLexicalComposerContext()

  useLayoutEffect(() => {
    editorRef.current = editor
    const store = useComposerStore.getState()
    store.setLexicalEditor(editor)
    setEditorDraft(editor, store.input, store.selectedWagglePreset)
    return () => {
      editorRef.current = null
      useComposerStore.getState().setLexicalEditor(null)
    }
  }, [editor, editorRef])

  return null
}

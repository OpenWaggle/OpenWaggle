import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import type { LexicalEditor } from 'lexical'
import { type MutableRefObject, useEffect } from 'react'
import { useComposerStore } from '@/stores/composer-store'

interface EditorRefPluginProps {
  editorRef: MutableRefObject<LexicalEditor | null>
}

/**
 * Exposes the Lexical editor instance via a ref for programmatic access
 * (voice insertion, history navigation, skill/mention insertion, etc.)
 * Also stores the editor in the composer Zustand store for cross-component access.
 */
export function EditorRefPlugin({ editorRef }: EditorRefPluginProps): null {
  const [editor] = useLexicalComposerContext()

  useEffect(() => {
    editorRef.current = editor
    useComposerStore.getState().setLexicalEditor(editor)
    return () => {
      editorRef.current = null
      useComposerStore.getState().setLexicalEditor(null)
    }
  }, [editor, editorRef])

  return null
}

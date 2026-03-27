import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { $getRoot } from 'lexical'
import { useEffect } from 'react'
import { useComposerStore } from '@/stores/composer-store'

/**
 * Syncs Lexical editor text content to the Zustand composer store.
 * This keeps `composer-store.input` current for submission, voice, history, and canSend checks.
 */
export function SyncPlugin(): null {
  const [editor] = useLexicalComposerContext()

  useEffect(() => {
    return editor.registerUpdateListener(({ editorState }) => {
      editorState.read(() => {
        const text = $getRoot().getTextContent()
        useComposerStore.getState().setInput(text)
      })
    })
  }, [editor])

  return null
}

import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { $getRoot, $nodesOfType } from 'lexical'
import { useEffect } from 'react'
import { useComposerStore } from '@/features/composer/state/composer-store'
import { WaggleMentionNode } from '../nodes/WaggleMentionNode'

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
        const store = useComposerStore.getState()
        store.setInput(text)
        const preset = $nodesOfType(WaggleMentionNode)[0]?.getPreset() ?? null
        if (store.selectedWagglePreset?.id !== preset?.id) {
          store.setSelectedWagglePreset(preset)
        }
      })
    })
  }, [editor])

  return null
}

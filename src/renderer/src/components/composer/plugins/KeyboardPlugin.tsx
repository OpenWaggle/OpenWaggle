import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import {
  $getRoot,
  $getSelection,
  $isRangeSelection,
  COMMAND_PRIORITY_NORMAL,
  KEY_DOWN_COMMAND,
} from 'lexical'
import { useEffect } from 'react'
import { useComposerStore } from '@/stores/composer-store'
import { useUIStore } from '@/stores/ui-store'
import { setEditorText } from '../lexical-utils'

interface KeyboardPluginProps {
  onSubmit: (text: string) => void
}

export function KeyboardPlugin({ onSubmit }: KeyboardPluginProps): null {
  const [editor] = useLexicalComposerContext()

  useEffect(() => {
    return editor.registerCommand<KeyboardEvent>(
      KEY_DOWN_COMMAND,
      (event) => {
        // Enter without modifier → submit
        if (event.key === 'Enter' && !event.shiftKey) {
          event.preventDefault()
          const text = editor.getEditorState().read(() => $getRoot().getTextContent())
          onSubmit(text)
          return true
        }

        // ArrowUp at position 0 → recall previous prompt
        if (event.key === 'ArrowUp') {
          const shouldNavigate = editor.getEditorState().read(() => {
            const selection = $getSelection()
            if (!$isRangeSelection(selection) || !selection.isCollapsed()) return false
            const anchor = selection.anchor
            return anchor.offset === 0 && anchor.getNode() === $getRoot().getFirstDescendant()
          })

          if (shouldNavigate) {
            const currentInput = useComposerStore.getState().input
            const prev = useComposerStore.getState().historyUp(currentInput)
            if (prev !== null) {
              event.preventDefault()
              setEditorText(editor, prev)
              return true
            }
          }
        }

        // ArrowDown at end → recall next prompt (or draft)
        if (event.key === 'ArrowDown') {
          const shouldNavigate = editor.getEditorState().read(() => {
            const selection = $getSelection()
            if (!$isRangeSelection(selection) || !selection.isCollapsed()) return false
            const anchor = selection.anchor
            const lastDescendant = $getRoot().getLastDescendant()
            if (!lastDescendant) return true
            return (
              anchor.getNode() === lastDescendant &&
              anchor.offset === lastDescendant.getTextContentSize()
            )
          })

          if (shouldNavigate) {
            const next = useComposerStore.getState().historyDown()
            if (next !== null) {
              event.preventDefault()
              setEditorText(editor, next)
              return true
            }
          }
        }

        return false
      },
      COMMAND_PRIORITY_NORMAL,
    )
  }, [editor, onSubmit])

  // Slash detection via text content listener
  useEffect(() => {
    return editor.registerTextContentListener((text) => {
      const trimmed = text.trimStart()
      if (trimmed === '/' || text.endsWith(' /')) {
        useUIStore.getState().openCommandPalette()
      }
    })
  }, [editor])

  return null
}

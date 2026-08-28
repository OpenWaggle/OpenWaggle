import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { $getSelection, $isRangeSelection, $isTextNode } from 'lexical'
import { useEffect } from 'react'
import { useUIStore } from '@/shell/ui-store'
import { findSlashCommandMatch } from '../../lib/slash-command'
import { useComposerStore } from '../../state/composer-store'

export function SlashCommandPlugin(): null {
  const [editor] = useLexicalComposerContext()

  useEffect(() => {
    return editor.registerUpdateListener(({ editorState }) => {
      const match = editorState.read(readActiveSlashCommand)
      const composer = useComposerStore.getState()
      const menu = useUIStore.getState()

      if (!match) {
        if (composer.activeSlashCommand) composer.setActiveSlashCommand(null)
        if (composer.dismissedSlashToken) composer.setDismissedSlashToken(null)
        if (composer.slashMenuFilter !== 'all') composer.setSlashMenuFilter('all')
        menu.closeSlashCommandMenu()
        return
      }

      if (
        composer.activeSlashCommand?.query !== match.query ||
        composer.activeSlashCommand?.token !== match.token
      ) {
        composer.setActiveSlashCommand(match)
        composer.setSlashHighlightIndex(0)
      }
      if (composer.dismissedSlashToken === match.token) {
        menu.closeSlashCommandMenu()
      } else {
        menu.openSlashCommandMenu()
      }
    })
  }, [editor])

  return null
}

function readActiveSlashCommand() {
  const selection = $getSelection()
  if (!$isRangeSelection(selection) || !selection.isCollapsed()) return null

  const textNode = selection.anchor.getNode()
  if (!$isTextNode(textNode)) return null

  const match = findSlashCommandMatch(textNode.getTextContent(), selection.anchor.offset)
  if (!match) return null

  return {
    query: match.query,
    token: `${textNode.getKey()}:${String(match.startOffset)}:${match.query}`,
  }
}

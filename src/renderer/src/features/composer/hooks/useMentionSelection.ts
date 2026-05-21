import type { FileSuggestion } from '@shared/types/composer'
import {
  $createTextNode,
  $getSelection,
  $isRangeSelection,
  $isTextNode,
  type LexicalEditor,
} from 'lexical'
import { useEffectEvent } from 'react'
import { $createFileMentionNode } from '../components/nodes/FileMentionNode'
import type { MentionMatch } from '../lib/mention-match'

interface UseMentionSelectionInput {
  readonly editor: LexicalEditor
  readonly match: MentionMatch | null
  readonly onClose: () => void
}

export function useMentionSelection({ editor, match, onClose }: UseMentionSelectionInput) {
  return useEffectEvent((item: FileSuggestion) => {
    editor.update(() => {
      const selection = $getSelection()
      if (!$isRangeSelection(selection) || !match) return

      const anchorNode = selection.anchor.getNode()
      if (!$isTextNode(anchorNode)) return

      const textContent = anchorNode.getTextContent()
      const beforeAt = textContent.slice(0, match.startOffset)
      const afterQuery = textContent.slice(match.startOffset + 1 + match.query.length)
      const mentionNode = $createFileMentionNode(item.path, item.basename)
      const trailingText = $createTextNode(`${afterQuery} `)

      anchorNode.setTextContent(beforeAt)
      anchorNode.insertAfter(mentionNode)
      mentionNode.insertAfter(trailingText)
      trailingText.select()
    })

    onClose()
    editor.focus()
  })
}

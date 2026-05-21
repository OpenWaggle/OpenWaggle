import { $getSelection, $isRangeSelection, $isTextNode, type LexicalEditor } from 'lexical'
import { useEffect, useState } from 'react'
import { findMentionMatch, type MentionMatch } from '../lib/mention-match'

const DROPDOWN_GAP_PX = 4

export function useMentionDetection(editor: LexicalEditor) {
  const [match, setMatch] = useState<MentionMatch | null>(null)
  const [position, setPosition] = useState({ top: 0, left: 0 })

  useEffect(() => {
    return editor.registerUpdateListener(({ editorState }) => {
      editorState.read(() => {
        setMatch(readMentionMatch())
      })
      requestAnimationFrame(() => updateDropdownPosition(setPosition))
    })
  }, [editor])

  return {
    match,
    position,
    clearMatch: () => setMatch(null),
  }
}

function readMentionMatch() {
  const selection = $getSelection()
  if (!$isRangeSelection(selection) || !selection.isCollapsed()) return null

  const anchor = selection.anchor
  const anchorNode = anchor.getNode()
  if (!$isTextNode(anchorNode)) return null

  return findMentionMatch(anchorNode.getTextContent(), anchor.offset)
}

function updateDropdownPosition(setPosition: (position: { top: number; left: number }) => void) {
  const windowSelection = window.getSelection()
  if (!windowSelection || windowSelection.rangeCount === 0) return

  const range = windowSelection.getRangeAt(0)
  if (typeof range.getBoundingClientRect !== 'function') return

  const rect = range.getBoundingClientRect()
  if (rect.top > 0) setPosition({ top: rect.top - DROPDOWN_GAP_PX, left: rect.left })
}

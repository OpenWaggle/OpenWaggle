import type { FileSuggestion } from '@shared/types/composer'
import { COMMAND_PRIORITY_HIGH, KEY_DOWN_COMMAND, type LexicalEditor } from 'lexical'
import { useEffect } from 'react'

interface UseMentionKeyboardInput {
  readonly editor: LexicalEditor
  readonly isOpen: boolean
  readonly suggestions: readonly FileSuggestion[]
  readonly highlightIndex: number
  readonly setHighlightIndex: (updater: (currentIndex: number) => number) => void
  readonly onSelect: (item: FileSuggestion) => void
  readonly onClose: () => void
}

export function useMentionKeyboard({
  editor,
  isOpen,
  suggestions,
  highlightIndex,
  setHighlightIndex,
  onSelect,
  onClose,
}: UseMentionKeyboardInput) {
  useEffect(() => {
    if (!isOpen) return

    return editor.registerCommand<KeyboardEvent>(
      KEY_DOWN_COMMAND,
      (event) =>
        handleMentionKeyDown({
          event,
          suggestions,
          highlightIndex,
          setHighlightIndex,
          onSelect,
          onClose,
        }),
      COMMAND_PRIORITY_HIGH,
    )
  }, [editor, isOpen, suggestions, highlightIndex, setHighlightIndex, onSelect, onClose])
}

interface MentionKeyDownInput extends Omit<UseMentionKeyboardInput, 'editor' | 'isOpen'> {
  readonly event: KeyboardEvent
}

function handleMentionKeyDown({
  event,
  suggestions,
  highlightIndex,
  setHighlightIndex,
  onSelect,
  onClose,
}: MentionKeyDownInput) {
  if (event.key === 'ArrowDown')
    return moveHighlight(event, setHighlightIndex, 1, suggestions.length)
  if (event.key === 'ArrowUp')
    return moveHighlight(event, setHighlightIndex, -1, suggestions.length)
  if (event.key === 'Enter' || event.key === 'Tab')
    return selectHighlighted(event, suggestions[highlightIndex], onSelect)
  if (event.key === 'Escape') return closeTypeahead(event, onClose)
  return false
}

function moveHighlight(
  event: KeyboardEvent,
  setHighlightIndex: MentionKeyDownInput['setHighlightIndex'],
  delta: 1 | -1,
  itemCount: number,
) {
  event.preventDefault()
  setHighlightIndex((currentIndex) => (currentIndex + delta + itemCount) % itemCount)
  return true
}

function selectHighlighted(
  event: KeyboardEvent,
  selected: FileSuggestion | undefined,
  onSelect: (item: FileSuggestion) => void,
) {
  event.preventDefault()
  if (selected) onSelect(selected)
  return true
}

function closeTypeahead(event: KeyboardEvent, onClose: () => void) {
  event.preventDefault()
  onClose()
  return true
}

import { match } from '@diegogbrisa/ts-match'
import { COMMAND_PRIORITY_HIGH, KEY_DOWN_COMMAND, type LexicalEditor } from 'lexical'
import { type RefObject, useEffect, useEffectEvent } from 'react'
import type { CommandPaletteItem } from '../model'

interface UseCommandPaletteKeyboardInput {
  readonly editor: LexicalEditor | null
  readonly items: readonly CommandPaletteItem[]
  readonly highlightIndex: number
  readonly setHighlightIndex: (index: number) => void
  readonly listRef: RefObject<HTMLDivElement | null>
  readonly onClose: () => void
}

export function useCommandPaletteKeyboard({
  editor,
  items,
  highlightIndex,
  setHighlightIndex,
  listRef,
  onClose,
}: UseCommandPaletteKeyboardInput) {
  function scrollHighlightedIntoView() {
    requestAnimationFrame(() => {
      const highlighted = listRef.current?.querySelector('[data-highlighted="true"]')
      highlighted?.scrollIntoView({ block: 'nearest' })
    })
  }

  function moveHighlight(delta: 1 | -1) {
    if (items.length === 0) return
    setHighlightIndex(nextEnabledHighlightIndex(items, highlightIndex, delta))
    scrollHighlightedIntoView()
  }

  const handleKeyDown = useEffectEvent((event: KeyboardEvent) => {
    match(event.key)
      .with('ArrowDown', () => {
        event.preventDefault()
        moveHighlight(1)
      })
      .with('ArrowUp', () => {
        event.preventDefault()
        moveHighlight(-1)
      })
      .with('Enter', () => {
        const selectedItem = items[highlightIndex]
        if (!selectedItem || selectedItem.disabled) return
        event.preventDefault()
        selectedItem.action()
      })
      .with('Tab', () => {
        const selectedItem = items[highlightIndex]
        if (!selectedItem || selectedItem.disabled) return
        event.preventDefault()
        selectedItem.action()
      })
      .with('Escape', () => {
        event.preventDefault()
        onClose()
      })
      .otherwise(() => undefined)
    return event.defaultPrevented
  })

  useEffect(() => {
    if (!editor) return
    return editor.registerCommand<KeyboardEvent>(
      KEY_DOWN_COMMAND,
      (event) => handleKeyDown(event),
      COMMAND_PRIORITY_HIGH,
    )
  }, [editor])
}

function nextHighlightIndex(currentIndex: number, delta: 1 | -1, itemCount: number) {
  if (delta === 1) return (currentIndex + 1) % itemCount
  return currentIndex === 0 ? itemCount - 1 : currentIndex - 1
}

function nextEnabledHighlightIndex(
  items: readonly CommandPaletteItem[],
  currentIndex: number,
  delta: 1 | -1,
) {
  let candidate = currentIndex
  for (let attempts = 0; attempts < items.length; attempts += 1) {
    candidate = nextHighlightIndex(candidate, delta, items.length)
    if (!items[candidate]?.disabled) return candidate
  }
  return currentIndex
}

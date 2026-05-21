import { match } from '@diegogbrisa/ts-match'
import type { KeyboardEvent, RefObject } from 'react'
import type { CommandPaletteItem } from '../model'

interface UseCommandPaletteKeyboardInput {
  readonly items: readonly CommandPaletteItem[]
  readonly highlightIndex: number
  readonly setHighlightIndex: (updater: (currentIndex: number) => number) => void
  readonly listRef: RefObject<HTMLDivElement | null>
}

export function useCommandPaletteKeyboard({
  items,
  highlightIndex,
  setHighlightIndex,
  listRef,
}: UseCommandPaletteKeyboardInput) {
  function scrollHighlightedIntoView() {
    requestAnimationFrame(() => {
      const highlighted = listRef.current?.querySelector('[data-highlighted="true"]')
      highlighted?.scrollIntoView({ block: 'nearest' })
    })
  }

  function moveHighlight(delta: 1 | -1) {
    if (items.length === 0) return
    setHighlightIndex((currentIndex) => nextHighlightIndex(currentIndex, delta, items.length))
    scrollHighlightedIntoView()
  }

  return (event: KeyboardEvent) => {
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
        if (!selectedItem) return
        event.preventDefault()
        selectedItem.action()
      })
      .otherwise(() => undefined)
  }
}

function nextHighlightIndex(currentIndex: number, delta: 1 | -1, itemCount: number) {
  if (delta === 1) return (currentIndex + 1) % itemCount
  return currentIndex === 0 ? itemCount - 1 : currentIndex - 1
}

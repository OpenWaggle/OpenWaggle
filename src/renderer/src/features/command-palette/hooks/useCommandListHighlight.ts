import { useEffect, useId, useRef, useState } from 'react'
import { commandPaletteOptionId, firstEnabledCommandIndex } from '../lib/command-palette-navigation'
import type { CommandPaletteItem } from '../model'

/**
 * The highlighted option of a combobox-driven command list: it starts on the first enabled item,
 * stays inside the current matches, and scrolls into view as it moves.
 */
export function useCommandListHighlight(items: readonly CommandPaletteItem[]) {
  /** `null` highlights the first enabled item of whatever the query currently matches. */
  const [highlightIndex, setHighlightIndex] = useState<number | null>(null)
  const listboxId = useId()
  const listRef = useRef<HTMLDivElement | null>(null)
  const boundedHighlightIndex = Math.min(
    highlightIndex ?? firstEnabledCommandIndex(items),
    Math.max(0, items.length - 1),
  )
  const highlightedItem = items[boundedHighlightIndex]
  const activeOptionId = highlightedItem
    ? commandPaletteOptionId(listboxId, highlightedItem.id)
    : undefined

  useEffect(() => {
    void boundedHighlightIndex
    listRef.current
      ?.querySelector<HTMLElement>('[data-highlighted="true"]')
      ?.scrollIntoView({ block: 'nearest' })
  }, [boundedHighlightIndex])

  return { activeOptionId, boundedHighlightIndex, listboxId, listRef, setHighlightIndex }
}

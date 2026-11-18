import type { CommandPaletteItem } from '../model'

type NavigableItem = Pick<CommandPaletteItem, 'disabled'>

function wrappedIndex(currentIndex: number, delta: 1 | -1, itemCount: number) {
  if (delta === 1) return (currentIndex + 1) % itemCount
  return currentIndex <= 0 ? itemCount - 1 : currentIndex - 1
}

/** The next enabled item in `delta` direction, wrapping; stays put when nothing else is enabled. */
export function nextEnabledCommandIndex(
  items: readonly NavigableItem[],
  currentIndex: number,
  delta: 1 | -1,
) {
  let candidate = currentIndex
  // One attempt per item: a full wrap visits every other item once.
  for (const _attempt of items) {
    candidate = wrappedIndex(candidate, delta, items.length)
    if (!items[candidate]?.disabled) return candidate
  }
  return currentIndex
}

/** The first enabled item, or 0 when every item is disabled (or there are none). */
export function firstEnabledCommandIndex(items: readonly NavigableItem[]) {
  const index = items.findIndex((item) => !item.disabled)
  return index === -1 ? 0 : index
}

/**
 * The DOM id of a listbox option, which the combobox names in `aria-activedescendant`. It follows
 * the item rather than its position, so the attribute changes (and is announced) when filtering
 * brings a different item to the highlighted row. Item ids can hold spaces (project paths), so
 * they are encoded to stay valid id tokens.
 */
export function commandPaletteOptionId(listboxId: string, itemId: string) {
  return `${listboxId}-option-${encodeURIComponent(itemId)}`
}

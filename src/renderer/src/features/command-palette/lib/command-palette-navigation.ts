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
  for (let attempts = 0; attempts < items.length; attempts += 1) {
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

/** The DOM id of a listbox option, which the combobox names in `aria-activedescendant`. */
export function commandPaletteOptionId(listboxId: string, index: number) {
  return `${listboxId}-option-${index}`
}

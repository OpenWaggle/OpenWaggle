import type { RefObject } from 'react'
import { groupCommandPaletteItems } from '../lib/command-palette-entries'
import { commandPaletteOptionId } from '../lib/command-palette-navigation'
import type { CommandPaletteItem } from '../model'
import { CommandPaletteItemButton } from './CommandPaletteItemButton'
import { CommandPaletteSectionHeader } from './CommandPaletteList'

interface CommandPaletteListboxProps {
  readonly items: readonly CommandPaletteItem[]
  readonly highlightIndex: number
  readonly onHighlightIndexChange: (index: number) => void
  readonly listRef: RefObject<HTMLDivElement | null>
  /** The listbox's DOM id, which its combobox names in `aria-controls`. */
  readonly listboxId: string
  readonly label: string
}

/**
 * The result list of a combobox: `option`s grouped by section, with the highlighted one named by
 * the combobox's `aria-activedescendant` (WAI-ARIA APG listbox with grouped options). Focus stays in
 * the combobox, so options are left out of the Tab order. A section is a `<fieldset>`, whose
 * implicit role is `group`.
 */
export function CommandPaletteListbox({
  items,
  highlightIndex,
  onHighlightIndexChange,
  listRef,
  listboxId,
  label,
}: CommandPaletteListboxProps) {
  const renderOption = (entry: { readonly item: CommandPaletteItem; readonly index: number }) => (
    <CommandPaletteItemButton
      key={entry.item.id}
      item={entry.item}
      highlighted={entry.index === highlightIndex}
      index={entry.index}
      onHighlightIndexChange={onHighlightIndexChange}
      optionId={commandPaletteOptionId(listboxId, entry.item.id)}
    />
  )

  return (
    <>
      <div
        ref={listRef}
        id={listboxId}
        role="listbox"
        aria-label={label}
        className="max-h-100 overflow-y-auto"
      >
        {groupCommandPaletteItems(items).map((group) => {
          if (group.label === undefined) return group.entries.map(renderOption)
          const headerId = `${listboxId}-${group.key}`
          return (
            <fieldset key={group.key} aria-labelledby={headerId} className="min-w-0">
              <CommandPaletteSectionHeader id={headerId} label={group.label} />
              {group.entries.map(renderOption)}
            </fieldset>
          )
        })}
      </div>
      {/* Always mounted: a live region only announces changes once it is in the tree. */}
      <output
        className={
          items.length === 0
            ? 'flex h-16 items-center justify-center text-sm text-text-muted'
            : 'sr-only'
        }
      >
        {items.length === 0 ? 'No matching commands' : ''}
      </output>
    </>
  )
}

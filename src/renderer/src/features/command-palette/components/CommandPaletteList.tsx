import type { RefObject } from 'react'
import { buildCommandPaletteEntries } from '../lib/command-palette-entries'
import { commandPaletteOptionId } from '../lib/command-palette-navigation'
import type { CommandPaletteItem } from '../model'
import { CommandPaletteItemButton } from './CommandPaletteItemButton'

interface CommandPaletteListProps {
  readonly items: readonly CommandPaletteItem[]
  readonly highlightIndex: number
  readonly onHighlightIndexChange: (index: number) => void
  readonly listRef: RefObject<HTMLDivElement | null>
  /**
   * Renders the list as a `listbox` of `option`s owned by a combobox input, which points at the
   * highlighted option through `aria-activedescendant` (see `commandPaletteOptionId`). Without it
   * the items are `menuitem`s of the surrounding menu.
   */
  readonly listboxId?: string
  readonly label?: string
}

export function CommandPaletteList({
  items,
  highlightIndex,
  onHighlightIndexChange,
  listRef,
  listboxId,
  label,
}: CommandPaletteListProps) {
  const entries = buildCommandPaletteEntries(items)

  return (
    <div
      ref={listRef}
      {...(listboxId ? { id: listboxId, role: 'listbox', 'aria-label': label } : {})}
      className="max-h-100 overflow-y-auto"
    >
      {items.length === 0 ? <CommandPaletteEmptyState /> : null}
      {entries.map((entry) => {
        if (entry.type === 'section')
          return <CommandPaletteSectionHeader key={entry.key} label={entry.label} />
        if (entry.type === 'separator')
          return <div key={entry.key} role="presentation" className="border-t border-border" />
        return (
          <CommandPaletteItemButton
            key={entry.key}
            item={entry.item}
            highlighted={entry.index === highlightIndex}
            index={entry.index}
            onHighlightIndexChange={onHighlightIndexChange}
            optionId={listboxId ? commandPaletteOptionId(listboxId, entry.index) : undefined}
          />
        )
      })}
    </div>
  )
}

function CommandPaletteEmptyState() {
  return (
    <div className="flex h-16 items-center justify-center text-sm text-text-muted">
      No matching commands
    </div>
  )
}

interface CommandPaletteSectionHeaderProps {
  readonly label: string
}

function CommandPaletteSectionHeader({ label }: CommandPaletteSectionHeaderProps) {
  return (
    <div role="presentation" className="flex h-7 items-center border-t border-border px-3.5">
      <span className="text-xs font-medium text-text-muted">{label}</span>
    </div>
  )
}

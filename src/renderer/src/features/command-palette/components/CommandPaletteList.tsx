import type { RefObject } from 'react'
import { buildCommandPaletteEntries } from '../lib/command-palette-entries'
import type { CommandPaletteItem } from '../model'
import { CommandPaletteItemButton } from './CommandPaletteItemButton'

interface CommandPaletteListProps {
  readonly items: readonly CommandPaletteItem[]
  readonly highlightIndex: number
  readonly onHighlightIndexChange: (index: number) => void
  readonly listRef: RefObject<HTMLDivElement | null>
}

export function CommandPaletteList({
  items,
  highlightIndex,
  onHighlightIndexChange,
  listRef,
}: CommandPaletteListProps) {
  const entries = buildCommandPaletteEntries(items)

  return (
    <div ref={listRef} className="max-h-[400px] overflow-y-auto">
      {items.length === 0 ? <CommandPaletteEmptyState /> : null}
      {entries.map((entry) => {
        if (entry.type === 'section')
          return <CommandPaletteSectionHeader key={entry.key} label={entry.label} />
        if (entry.type === 'separator')
          return <div key={entry.key} className="border-t border-border" />
        return (
          <CommandPaletteItemButton
            key={entry.key}
            item={entry.item}
            highlighted={entry.index === highlightIndex}
            index={entry.index}
            onHighlightIndexChange={onHighlightIndexChange}
          />
        )
      })}
    </div>
  )
}

function CommandPaletteEmptyState() {
  return (
    <div className="flex h-16 items-center justify-center text-[13px] text-text-muted">
      No matching commands
    </div>
  )
}

interface CommandPaletteSectionHeaderProps {
  readonly label: string
}

function CommandPaletteSectionHeader({ label }: CommandPaletteSectionHeaderProps) {
  return (
    <div className="flex h-7 items-center border-t border-border px-3.5">
      <span className="text-[11px] font-medium text-text-muted">{label}</span>
    </div>
  )
}

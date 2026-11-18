import type { CommandPaletteItem } from '../model'

type CommandPaletteEntry =
  | { readonly type: 'section'; readonly key: string; readonly label: string }
  | { readonly type: 'separator'; readonly key: string }
  | {
      readonly type: 'item'
      readonly key: string
      readonly item: CommandPaletteItem
      readonly index: number
    }

export function buildCommandPaletteEntries(items: readonly CommandPaletteItem[]) {
  const entries: CommandPaletteEntry[] = []
  let lastSection: string | undefined

  items.forEach((item, index) => {
    const isConfigureSection = item.section === 'configure'
    const shouldShowSectionHeader =
      item.section && !isConfigureSection && item.section !== lastSection
    const shouldShowSeparator = isConfigureSection && lastSection !== 'configure'

    if (shouldShowSectionHeader) {
      entries.push({
        type: 'section',
        key: `section-${item.section}-${index}`,
        label: item.section,
      })
    }

    if (shouldShowSeparator) {
      entries.push({ type: 'separator', key: `separator-${index}` })
    }

    entries.push({ type: 'item', key: item.id, item, index })
    lastSection = item.section
  })

  return entries
}

interface CommandPaletteGroupEntry {
  readonly item: CommandPaletteItem
  readonly index: number
}

export interface CommandPaletteGroup {
  /**
   * Stable while filtering (the section plus how often it already appeared), unique within one
   * list, and safe as a DOM id fragment (section names contain spaces).
   */
  readonly key: string
  /** The visible section name; `undefined` for items rendered outside a named section. */
  readonly label: string | undefined
  readonly entries: readonly CommandPaletteGroupEntry[]
}

/** Consecutive items of one section, for a listbox that exposes each section as a `group`. */
export function groupCommandPaletteItems(items: readonly CommandPaletteItem[]) {
  const groups: { key: string; label: string | undefined; entries: CommandPaletteGroupEntry[] }[] =
    []
  const sectionOccurrences = new Map<string, number>()
  items.forEach((item, index) => {
    const current = groups.at(-1)
    if (current !== undefined && items[index - 1]?.section === item.section) {
      current.entries.push({ item, index })
      return
    }
    const label = item.section === 'configure' ? undefined : item.section
    const section = item.section ?? ''
    const occurrence = sectionOccurrences.get(section) ?? 0
    sectionOccurrences.set(section, occurrence + 1)
    groups.push({
      key: `group-${encodeURIComponent(section)}-${occurrence}`,
      label,
      entries: [{ item, index }],
    })
  })
  const result: readonly CommandPaletteGroup[] = groups
  return result
}

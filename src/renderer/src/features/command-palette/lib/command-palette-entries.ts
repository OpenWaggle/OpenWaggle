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

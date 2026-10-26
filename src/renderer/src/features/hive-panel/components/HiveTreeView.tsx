import { match } from '@diegogbrisa/ts-match'
import { useId, useState } from 'react'
import type { HiveTreeItem } from '../lib/hive-tree-structure'
import { HiveTreeItemRow } from './HiveTreeItem'

function isTreeItem(target: EventTarget): target is HTMLElement {
  return target instanceof HTMLElement && target.getAttribute('role') === 'treeitem'
}

/** Where a key moves focus in the flat tree, or which row it expands or collapses. */
function keyTarget(
  key: string,
  items: readonly HiveTreeItem[],
  index: number,
): { readonly focus?: number; readonly toggle?: boolean } | null {
  const item = items[index]
  if (!item) return null
  const parentIndex = () => {
    for (let at = index - 1; at >= 0; at -= 1) {
      if (items[at]?.level === item.level - 1) return at
    }
    return 0
  }
  return match(key)
    .with('ArrowDown', () => ({ focus: Math.min(index + 1, items.length - 1) }))
    .with('ArrowUp', () => ({ focus: Math.max(index - 1, 0) }))
    .with('Home', () => ({ focus: 0 }))
    .with('End', () => ({ focus: items.length - 1 }))
    .with('ArrowRight', () => {
      if (item.expanded === false) return { toggle: true }
      return item.expanded === true ? { focus: index + 1 } : null
    })
    .with('ArrowLeft', () => {
      if (item.expanded === true) return { toggle: true }
      return item.level > 1 ? { focus: parentIndex() } : null
    })
    .otherwise(() => null)
}

/**
 * The Hive panel's default view (#377): a WAI-ARIA tree of the whole Hive, each Worker under the
 * Worker or Queen that spawned it. It is a flat tree (`aria-level`, `aria-setsize`,
 * `aria-posinset` on each `treeitem`) with one row in the tab order. Arrow keys move and expand,
 * Home and End jump, and Enter opens the focused Session.
 */
export function HiveTreeView({
  items,
  currentSessionId,
  onOpen,
  onToggle,
}: {
  readonly items: readonly HiveTreeItem[]
  readonly currentSessionId: string | null
  readonly onOpen: (sessionId: string) => void
  readonly onToggle: (item: HiveTreeItem) => void
}) {
  const baseId = useId()
  const [focusedId, setFocusedId] = useState<string | null>(null)
  const domId = (sessionId: string) => `${baseId}-${sessionId}`
  // The focused row stays tabbable; until one is focused, the current Session's row or the Queen.
  const tabbableId =
    [focusedId, currentSessionId, items[0] ? String(items[0].session.id) : null].find(
      (id) => id !== null && items.some((item) => String(item.session.id) === id),
    ) ?? null

  function focusRow(index: number) {
    const target = items[index]
    if (!target) return
    const id = String(target.session.id)
    setFocusedId(id)
    document.getElementById(domId(id))?.focus()
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    const row = event.target
    if (!isTreeItem(row)) return
    const index = items.findIndex((item) => domId(String(item.session.id)) === row.id)
    const item = items[index]
    if (!item) return
    if (event.key === 'Enter') {
      event.preventDefault()
      onOpen(String(item.session.id))
      return
    }
    const target = keyTarget(event.key, items, index)
    if (target === null) return
    event.preventDefault()
    if (target.toggle) onToggle(item)
    if (target.focus !== undefined) focusRow(target.focus)
  }

  return (
    <div role="tree" aria-label="Hive">
      {items.map((item) => {
        const id = String(item.session.id)
        return (
          <HiveTreeItemRow
            key={id}
            item={item}
            domId={domId(id)}
            isCurrent={currentSessionId === id}
            tabbable={tabbableId === id}
            actions={{
              onOpen: () => onOpen(id),
              onToggle: () => onToggle(item),
              onFocusItem: () => setFocusedId(id),
              onKeyDown,
            }}
          />
        )
      })}
    </div>
  )
}

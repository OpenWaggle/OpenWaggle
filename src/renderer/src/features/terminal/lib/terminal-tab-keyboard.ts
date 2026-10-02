import type { KeyboardEvent } from 'react'

const TAB_NAVIGATION_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'Home', 'End'])

/** Roving tab focus across every tab in the strip, terminals and action output views alike. */
export function selectAdjacentTerminalTab(event: KeyboardEvent<HTMLButtonElement>) {
  if (!TAB_NAVIGATION_KEYS.has(event.key)) return false
  event.preventDefault()
  const tablist = event.currentTarget.closest('[role="tablist"]')
  const tabs = [...(tablist?.querySelectorAll<HTMLButtonElement>('[role="tab"]') ?? [])]
  const current = tabs.indexOf(event.currentTarget)
  const nextIndex =
    event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? tabs.length - 1
        : (current + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length
  tabs[nextIndex]?.focus()
  tabs[nextIndex]?.click()
  return true
}

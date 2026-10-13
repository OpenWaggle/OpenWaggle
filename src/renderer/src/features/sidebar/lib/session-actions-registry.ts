import type { SidebarSessionActions } from '../model'

/**
 * The Sidebar's session actions, shared with Hive panel rows (ADR 0051).
 *
 * The Sidebar owns the domain actions — removal navigation, pins, toasts — so the registry is
 * a hand-off, not a second implementation: the Hive panel's ⋯ menu behaves exactly like the
 * sidebar's because it is the same object. Registration lasts while a Sidebar is mounted;
 * before that the Hive panel has no actions to offer and hides its menu instead.
 */
let registered: SidebarSessionActions | null = null
const listeners = new Set<() => void>()

export function registerSidebarSessionActions(next: SidebarSessionActions | null) {
  registered = next
  for (const listener of listeners) listener()
}

export function sidebarSessionActions(): SidebarSessionActions | null {
  return registered
}

export function subscribeSidebarSessionActions(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

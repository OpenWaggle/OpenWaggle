import { useSyncExternalStore } from 'react'
import { sidebarSessionActions, subscribeSidebarSessionActions } from '@/features/sidebar/lib'

/**
 * The Sidebar's session actions for Hive panel rows (ADR 0051).
 *
 * Null until a Sidebar has mounted: the panel then has no ⋯ menu to offer, which only happens
 * before the shell finishes mounting, never in a steady state.
 */
export function useHivePanelSessionActions() {
  return useSyncExternalStore(subscribeSidebarSessionActions, sidebarSessionActions)
}

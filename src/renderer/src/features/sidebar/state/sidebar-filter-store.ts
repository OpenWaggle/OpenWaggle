import { create } from 'zustand'
import type { SidebarRowState } from '../lib/sidebar-row-state'

/**
 * The state filter applied across every project.
 *
 * Deliberately not persisted. A filter subtracts sessions, so one left over from days ago
 * would open the app on a nearly empty list with no memory of why. Sorting and collapsing
 * rearrange and are safe to remember; this is not. The chips still show their counts when no
 * filter is active, so nothing has to be filtered in order to see that something failed.
 */
interface SidebarFilterState {
  readonly activeState: SidebarRowState | null
  readonly toggleState: (state: SidebarRowState) => void
  readonly clear: () => void
}

export const useSidebarFilterStore = create<SidebarFilterState>()((set) => ({
  activeState: null,

  // Clicking the active chip clears it, so the same control both applies and removes.
  toggleState: (state) =>
    set((current) => ({ activeState: current.activeState === state ? null : state })),

  clear: () => set((current) => (current.activeState === null ? current : { activeState: null })),
}))

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
  /** Free-text filter over project and session names. Also deliberately not persisted. */
  readonly query: string
  /**
   * Bumped when something asks for the filter field to take focus.
   *
   * A counter rather than a boolean, so a second request while the field is already focused still
   * registers, and so the field never has to reset a flag it did not set.
   */
  readonly focusRequest: number
  /**
   * Whether the filter field holds focus.
   *
   * Escape belongs to the field only while it is focused. Tracked here rather than read from
   * document.activeElement so the shortcut can be registered conditionally, which is what keeps it
   * from cancelling Escape for every dialog in the application.
   */
  readonly searchFocused: boolean
  readonly toggleState: (state: SidebarRowState) => void
  readonly setQuery: (query: string) => void
  readonly requestFocus: () => void
  readonly setSearchFocused: (focused: boolean) => void
  readonly clear: () => void
}

export const useSidebarFilterStore = create<SidebarFilterState>()((set) => ({
  activeState: null,
  query: '',
  focusRequest: 0,
  searchFocused: false,

  // Clicking the active chip clears it, so the same control both applies and removes.
  toggleState: (state) =>
    set((current) => ({ activeState: current.activeState === state ? null : state })),

  setQuery: (query) => set((current) => (current.query === query ? current : { query })),

  requestFocus: () => set((current) => ({ focusRequest: current.focusRequest + 1 })),

  setSearchFocused: (focused) =>
    set((current) => (current.searchFocused === focused ? current : { searchFocused: focused })),

  clear: () =>
    set((current) =>
      current.activeState === null && current.query === ''
        ? current
        : { activeState: null, query: '' },
    ),
}))

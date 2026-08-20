import { useHotkeys } from '@tanstack/react-hotkeys'
import { useUIStore } from '@/shell/ui-store'
import { useSidebarFilterStore } from '../state/sidebar-filter-store'

/** Marks the filter field so Escape can tell it apart from any other focused input. */
const SEARCH_CONTAINER_SELECTOR = '[data-qa="sidebar-search"]'

/**
 * Mod+F focuses the sidebar's filter field.
 *
 * The field advertises this shortcut on its right-hand side, so the binding has to exist: a
 * hint for a shortcut that does nothing is worse than no hint, because the user stops trusting
 * the others. Opens the sidebar first when it is collapsed, since focusing a hidden field would
 * silently do nothing.
 *
 * The request is recorded in the store and the field focuses itself. Reaching into the DOM from
 * here instead needed a requestAnimationFrame to wait for the sidebar to mount, which raced that
 * mount and flaked under load.
 */
export function useSidebarSearchShortcut(): void {
  const sidebarOpen = useUIStore((state) => state.sidebarOpen)
  const toggleSidebar = useUIStore((state) => state.toggleSidebar)
  const clearFilters = useSidebarFilterStore((state) => state.clear)
  const requestFocus = useSidebarFilterStore((state) => state.requestFocus)

  useHotkeys(
    [
      {
        hotkey: 'Mod+F',
        callback: () => {
          if (!sidebarOpen) toggleSidebar()
          requestFocus()
        },
      },
      {
        // Escape from the field clears what it narrowed, which is the way out of a filtered
        // sidebar without reaching for the mouse.
        hotkey: 'Escape',
        callback: () => {
          const active = document.activeElement
          if (active instanceof HTMLInputElement && active.closest(SEARCH_CONTAINER_SELECTOR)) {
            clearFilters()
            active.blur()
          }
        },
      },
    ],
    { preventDefault: true },
  )
}

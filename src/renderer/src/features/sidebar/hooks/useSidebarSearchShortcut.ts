import { useHotkeys } from '@tanstack/react-hotkeys'
import { useUIStore } from '@/shell/ui-store'
import { useSidebarFilterStore } from '../state/sidebar-filter-store'

/** The element the sidebar's filter field renders, found without a ref across components. */
const SEARCH_INPUT_SELECTOR = '[data-qa="sidebar-search"] input'

/**
 * Mod+F focuses the sidebar's filter field.
 *
 * The field advertises this shortcut on its right-hand side, so the binding has to exist: a
 * hint for a shortcut that does nothing is worse than no hint, because the user stops trusting
 * the others. Opens the sidebar first when it is collapsed, since focusing a hidden field would
 * silently do nothing.
 */
export function useSidebarSearchShortcut(): void {
  const sidebarOpen = useUIStore((state) => state.sidebarOpen)
  const toggleSidebar = useUIStore((state) => state.toggleSidebar)
  const clearFilters = useSidebarFilterStore((state) => state.clear)

  useHotkeys(
    [
      {
        hotkey: 'Mod+F',
        callback: () => {
          if (!sidebarOpen) toggleSidebar()
          // After the sidebar mounts, not in the same frame the toggle happens.
          requestAnimationFrame(() => {
            const input = document.querySelector(SEARCH_INPUT_SELECTOR)
            if (input instanceof HTMLInputElement) {
              input.focus()
              input.select()
            }
          })
        },
      },
      {
        // Escape from the field clears what it narrowed, which is the way out of a filtered
        // sidebar without reaching for the mouse.
        hotkey: 'Escape',
        callback: () => {
          const active = document.activeElement
          if (active instanceof HTMLInputElement && active.closest('[data-qa="sidebar-search"]')) {
            clearFilters()
            active.blur()
          }
        },
      },
    ],
    { preventDefault: true },
  )
}

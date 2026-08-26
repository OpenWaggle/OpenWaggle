import { useHotkey } from '@tanstack/react-hotkeys'
import { useLocation } from '@tanstack/react-router'
import { useUIStore } from '@/shell/ui-store'
import { useSidebarFilterStore } from '../state/sidebar-filter-store'
import { activeViewFromPathname } from './sidebar-view'

/**
 * Mod+F focuses the sidebar's filter field, and Escape clears it while it holds focus.
 *
 * The field advertises Mod+F on its right-hand side, so the binding has to exist: a hint for a
 * shortcut that does nothing is worse than no hint, because the user stops trusting the others.
 * Opens the sidebar first when it is collapsed, since focusing a hidden field would silently do
 * nothing, and records the request in the store so the field can focus itself rather than being
 * found by a DOM query that races the sidebar mounting.
 *
 * Escape is handled directly by the focused input. Keeping it at the target avoids a focus-state
 * subscription race and prevents a document hotkey from cancelling Escape for native dialogs.
 */
export function useSidebarSearchShortcut(): void {
  const sidebarOpen = useUIStore((state) => state.sidebarOpen)
  const toggleSidebar = useUIStore((state) => state.toggleSidebar)
  const requestFocus = useSidebarFilterStore((state) => state.requestFocus)
  const { pathname } = useLocation()
  // The settings view makes the sidebar inert, and an inert field cannot take focus.
  const sidebarCanFocus = activeViewFromPathname(pathname) !== 'settings'

  useHotkey(
    'Mod+F',
    () => {
      /*
       * Nothing happens in the settings view rather than a request that quietly evaporates.
       * The field is rendered but inert there, so focus() is a no-op, and the hint that advertises
       * this shortcut is not on screen either.
       */
      if (!sidebarCanFocus) return
      if (!sidebarOpen) toggleSidebar()
      requestFocus()
    },
    { preventDefault: true },
  )
}

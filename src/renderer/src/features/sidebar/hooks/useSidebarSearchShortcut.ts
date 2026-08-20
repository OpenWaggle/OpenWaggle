import { useHotkey } from '@tanstack/react-hotkeys'
import { useEscapeHotkey } from '@/shared/hooks/useEscapeHotkey'
import { useUIStore } from '@/shell/ui-store'
import { useSidebarFilterStore } from '../state/sidebar-filter-store'

/**
 * Mod+F focuses the sidebar's filter field, and Escape clears it while it holds focus.
 *
 * The field advertises Mod+F on its right-hand side, so the binding has to exist: a hint for a
 * shortcut that does nothing is worse than no hint, because the user stops trusting the others.
 * Opens the sidebar first when it is collapsed, since focusing a hidden field would silently do
 * nothing, and records the request in the store so the field can focus itself rather than being
 * found by a DOM query that races the sidebar mounting.
 *
 * Escape goes through useEscapeHotkey, not through a second useHotkeys entry.
 * @tanstack/react-hotkeys calls preventDefault and stopPropagation on every match before the
 * callback runs, so a plain Escape registration with preventDefault cancels Escape for the whole
 * application no matter what the callback then decides. Chromium will not close a native <dialog>
 * once a document-level listener has cancelled the key, which silently killed the only dismissal
 * CommitMessageDialog has. The shared hook exists for exactly this: it registers permissively and
 * prevents the default only when it owns the topmost overlay.
 */
export function useSidebarSearchShortcut(): void {
  const sidebarOpen = useUIStore((state) => state.sidebarOpen)
  const toggleSidebar = useUIStore((state) => state.toggleSidebar)
  const clearFilters = useSidebarFilterStore((state) => state.clear)
  const requestFocus = useSidebarFilterStore((state) => state.requestFocus)
  const searchFocused = useSidebarFilterStore((state) => state.searchFocused)

  useHotkey(
    'Mod+F',
    () => {
      if (!sidebarOpen) toggleSidebar()
      requestFocus()
    },
    { preventDefault: true },
  )

  // Only claims Escape while the field actually holds focus, so every other overlay keeps it.
  useEscapeHotkey(
    () => {
      clearFilters()
      const active = document.activeElement
      if (active instanceof HTMLInputElement) active.blur()
    },
    { enabled: searchFocused },
  )
}

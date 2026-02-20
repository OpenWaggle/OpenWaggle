import { useEffect } from 'react'

interface KeyboardShortcut {
  readonly key: string
  /** When true, matches metaKey || ctrlKey */
  readonly ctrl?: boolean
  readonly action: () => void
}

export function useKeyboardShortcuts(shortcuts: readonly KeyboardShortcut[]): void {
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent): void {
      for (const shortcut of shortcuts) {
        if (shortcut.ctrl && !(e.metaKey || e.ctrlKey)) continue
        if (e.key !== shortcut.key) continue

        e.preventDefault()
        shortcut.action()
        return
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [shortcuts])
}

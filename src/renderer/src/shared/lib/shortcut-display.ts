import type { ShortcutBinding } from '@shared/types/shortcuts'

export function usesAppleShortcuts() {
  return /Mac|iPhone|iPad|iPod/i.test(navigator.userAgent)
}

export function formatShortcutBinding(binding: ShortcutBinding | null) {
  if (!binding) return 'Unassigned'
  const apple = usesAppleShortcuts()
  const parts = [
    binding.mod ? (apple ? '⌘' : 'Ctrl') : '',
    binding.ctrl ? 'Ctrl' : '',
    binding.alt ? (apple ? '⌥' : 'Alt') : '',
    binding.shift ? (apple ? '⇧' : 'Shift') : '',
    binding.meta ? (apple ? '⌘' : 'Meta') : '',
    binding.key,
  ].filter(Boolean)
  return apple ? parts.join('') : parts.join(' + ')
}

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

/** Platform-resolved equivalent for the ARIA `aria-keyshortcuts` attribute. */
export function formatAriaShortcutBinding(binding: ShortcutBinding | null) {
  if (!binding) return undefined
  const apple = usesAppleShortcuts()
  const modifiers = new Set<string>()
  if (binding.mod) modifiers.add(apple ? 'Meta' : 'Control')
  if (binding.ctrl) modifiers.add('Control')
  if (binding.alt) modifiers.add('Alt')
  if (binding.shift) modifiers.add('Shift')
  if (binding.meta) modifiers.add('Meta')
  const key = binding.key === ' ' ? 'Space' : binding.key === '+' ? 'Plus' : binding.key
  return [...modifiers, key].join('+')
}

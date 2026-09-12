import type { ShortcutBinding, ShortcutBindings, ShortcutCommand } from '@shared/types/shortcuts'

export type TerminalShortcutCommand = Extract<
  ShortcutCommand,
  'terminal.close' | 'terminal.new' | 'terminal.split' | 'terminal.splitVertical'
>

const TERMINAL_SHORTCUT_COMMANDS: readonly TerminalShortcutCommand[] = [
  'terminal.close',
  'terminal.new',
  'terminal.splitVertical',
  'terminal.split',
]

export interface TerminalShortcutEvent {
  readonly key: string
  readonly code?: string
  readonly altKey: boolean
  readonly ctrlKey: boolean
  readonly metaKey: boolean
  readonly shiftKey: boolean
  readonly isComposing?: boolean
  readonly repeat?: boolean
}

function normalizedKey(value: string) {
  return value === ' ' ? 'SPACE' : value.trim().toUpperCase()
}

function matchesPhysicalLetterOrDigit(event: TerminalShortcutEvent, expectedKey: string) {
  if (expectedKey.length !== 1 || event.code === undefined) return false
  if (/^[A-Z]$/.test(expectedKey)) return event.code === `Key${expectedKey}`
  if (/^[0-9]$/.test(expectedKey)) return event.code === `Digit${expectedKey}`
  return false
}

/** Exact cross-platform shortcut matching, with a physical-key fallback for non-Latin layouts. */
export function matchesTerminalShortcutBinding(
  event: TerminalShortcutEvent,
  binding: ShortcutBinding | null,
  applePlatform: boolean,
) {
  if (binding === null || event.isComposing === true || event.repeat === true) return false

  const expectsCtrl = binding.ctrl === true || (binding.mod === true && !applePlatform)
  const expectsMeta = binding.meta === true || (binding.mod === true && applePlatform)
  if (
    event.ctrlKey !== expectsCtrl ||
    event.metaKey !== expectsMeta ||
    event.altKey !== (binding.alt === true) ||
    event.shiftKey !== (binding.shift === true)
  ) {
    return false
  }

  const expectedKey = normalizedKey(binding.key)
  return (
    normalizedKey(event.key) === expectedKey || matchesPhysicalLetterOrDigit(event, expectedKey)
  )
}

export function resolveTerminalShortcut(
  event: TerminalShortcutEvent,
  bindings: ShortcutBindings,
  applePlatform: boolean,
): TerminalShortcutCommand | null {
  for (const command of TERMINAL_SHORTCUT_COMMANDS) {
    if (matchesTerminalShortcutBinding(event, bindings[command], applePlatform)) return command
  }
  return null
}

/** A held close chord must never fall through to xterm or the native window menu. */
export function isRepeatedTerminalCloseShortcut(
  event: TerminalShortcutEvent,
  bindings: ShortcutBindings,
  applePlatform: boolean,
) {
  return (
    event.repeat === true &&
    matchesTerminalShortcutBinding(
      {
        key: event.key,
        code: event.code,
        altKey: event.altKey,
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
        shiftKey: event.shiftKey,
        isComposing: event.isComposing,
        repeat: false,
      },
      bindings['terminal.close'],
      applePlatform,
    )
  )
}

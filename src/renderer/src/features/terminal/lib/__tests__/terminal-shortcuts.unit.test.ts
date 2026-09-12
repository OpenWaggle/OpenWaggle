import { DEFAULT_SHORTCUT_BINDINGS } from '@shared/types/shortcuts'
import { describe, expect, it } from 'vitest'
import {
  isRepeatedTerminalCloseShortcut,
  matchesTerminalShortcutBinding,
  resolveTerminalShortcut,
  type TerminalShortcutEvent,
} from '../terminal-shortcuts'

function event(overrides: Partial<TerminalShortcutEvent> = {}): TerminalShortcutEvent {
  return {
    key: 'd',
    code: 'KeyD',
    altKey: false,
    ctrlKey: false,
    metaKey: true,
    shiftKey: false,
    ...overrides,
  }
}

describe('terminal shortcuts', () => {
  it('resolves the parity split commands by exact modifiers', () => {
    expect(resolveTerminalShortcut(event(), DEFAULT_SHORTCUT_BINDINGS, true)).toBe('terminal.split')
    expect(
      resolveTerminalShortcut(event({ shiftKey: true }), DEFAULT_SHORTCUT_BINDINGS, true),
    ).toBe('terminal.splitVertical')
  })

  it('uses Control as Mod away from Apple platforms', () => {
    expect(
      resolveTerminalShortcut(
        event({ key: 'n', code: 'KeyN', ctrlKey: true, metaKey: false }),
        DEFAULT_SHORTCUT_BINDINGS,
        false,
      ),
    ).toBe('terminal.new')
  })

  it('matches physical Latin keys on non-Latin keyboard layouts', () => {
    expect(
      matchesTerminalShortcutBinding(
        event({ key: 'в', code: 'KeyD' }),
        DEFAULT_SHORTCUT_BINDINGS['terminal.split'],
        true,
      ),
    ).toBe(true)
  })

  it('does not steal composition, repeated, or extra-modifier input', () => {
    const binding = DEFAULT_SHORTCUT_BINDINGS['terminal.split']
    expect(matchesTerminalShortcutBinding(event({ isComposing: true }), binding, true)).toBe(false)
    expect(matchesTerminalShortcutBinding(event({ repeat: true }), binding, true)).toBe(false)
    expect(matchesTerminalShortcutBinding(event({ altKey: true }), binding, true)).toBe(false)
  })

  it('returns null for an unassigned terminal command', () => {
    expect(
      resolveTerminalShortcut(
        event({ key: 'w', code: 'KeyW' }),
        { ...DEFAULT_SHORTCUT_BINDINGS, 'terminal.close': null },
        true,
      ),
    ).toBeNull()
  })

  it('identifies a held close chord so it can be swallowed after the first close', () => {
    expect(
      isRepeatedTerminalCloseShortcut(
        event({ key: 'w', code: 'KeyW', repeat: true }),
        DEFAULT_SHORTCUT_BINDINGS,
        true,
      ),
    ).toBe(true)
    expect(
      isRepeatedTerminalCloseShortcut(
        event({ key: 'w', code: 'KeyW', repeat: false }),
        DEFAULT_SHORTCUT_BINDINGS,
        true,
      ),
    ).toBe(false)
  })
})

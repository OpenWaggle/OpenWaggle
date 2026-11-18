import { describe, expect, it } from 'vitest'
import {
  terminalClipboardShortcutAction,
  terminalNativeShortcutData,
} from '../terminal-native-keybindings'

function event(overrides: Partial<KeyboardEvent> = {}) {
  return {
    type: 'keydown',
    key: '',
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    ...overrides,
  }
}

describe('terminalNativeShortcutData', () => {
  it.each([
    [event({ key: 'l', ctrlKey: true }), 'Linux', '\u000c'],
    [event({ key: 'k', metaKey: true }), 'MacIntel', '\u000c'],
    [event({ key: 'Backspace', metaKey: true }), 'MacIntel', '\u0015'],
    [event({ key: 'ArrowLeft', metaKey: true }), 'MacIntel', '\u0001'],
    [event({ key: 'ArrowRight', metaKey: true }), 'MacIntel', '\u0005'],
    [event({ key: 'ArrowLeft', altKey: true }), 'MacIntel', '\u001bb'],
    [event({ key: 'ArrowRight', ctrlKey: true }), 'Linux', '\u001bf'],
    [event({ key: 'ArrowLeft', altKey: true }), 'Win32', '\u001bb'],
  ])('maps native editing gesture %#', (keyEvent, platform, expected) => {
    expect(terminalNativeShortcutData(keyEvent, platform)).toBe(expected)
  })

  it.each([
    event({ type: 'keyup', key: 'l', ctrlKey: true }),
    event({ key: 'ArrowLeft', metaKey: true, shiftKey: true }),
    event({ key: 'ArrowLeft' }),
    event({ key: 'Backspace', metaKey: true, altKey: true }),
    event({ key: 'ArrowRight', altKey: true, ctrlKey: true }),
  ])('leaves unrelated or modified gestures to xterm', (keyEvent) => {
    expect(terminalNativeShortcutData(keyEvent, 'MacIntel')).toBeNull()
  })
})

describe('terminalClipboardShortcutAction', () => {
  it('leaves printable AltGraph chords to xterm', () => {
    const altGraph = event({
      key: 'c',
      ctrlKey: true,
      getModifierState: (modifier) => modifier === 'AltGraph',
    })

    expect(terminalClipboardShortcutAction(altGraph, 'Linux')).toBeNull()
    expect(terminalNativeShortcutData({ ...altGraph, key: 'l' }, 'Linux')).toBeNull()
  })

  it('keeps Ctrl+C for SIGINT on macOS and copies with Command+C', () => {
    expect(
      terminalClipboardShortcutAction(event({ key: 'c', ctrlKey: true }), 'MacIntel'),
    ).toBeNull()
    expect(terminalClipboardShortcutAction(event({ key: 'C', metaKey: true }), 'MacIntel')).toBe(
      'copy',
    )
  })

  it('copies with Ctrl+C or Ctrl+Shift+C away from macOS', () => {
    expect(terminalClipboardShortcutAction(event({ key: 'c', ctrlKey: true }), 'Linux')).toBe(
      'copy',
    )
    expect(
      terminalClipboardShortcutAction(event({ key: 'c', ctrlKey: true, shiftKey: true }), 'Win32'),
    ).toBe('copy')
  })

  it('uses platform-native paste gestures without stealing literal Ctrl+V', () => {
    expect(terminalClipboardShortcutAction(event({ key: 'v', metaKey: true }), 'MacIntel')).toBe(
      'paste',
    )
    expect(terminalClipboardShortcutAction(event({ key: 'v', ctrlKey: true }), 'Linux')).toBeNull()
    expect(
      terminalClipboardShortcutAction(event({ key: 'v', ctrlKey: true, shiftKey: true }), 'Linux'),
    ).toBe('paste')
    expect(terminalClipboardShortcutAction(event({ key: 'Insert', shiftKey: true }), 'Linux')).toBe(
      'paste',
    )
  })
})

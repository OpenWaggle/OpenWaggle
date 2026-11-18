import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(() => {
  Reflect.deleteProperty(navigator, 'keyboard')
  vi.resetModules()
})

/** A Keyboard API whose layout the test can switch, as the OS does without telling Chromium. */
async function loadWithKeyboard(initial: string) {
  const current = { layout: initial }
  const layouts: Readonly<Record<string, readonly (readonly [string, string])[]>> = {
    us: [['KeyQ', 'q']],
    azerty: [['KeyQ', 'a']],
  }
  Object.defineProperty(navigator, 'keyboard', {
    configurable: true,
    value: { getLayoutMap: async () => new Map(layouts[current.layout]) },
  })
  const module = await import('../keyboard-layout')
  return { ...module, switchTo: (next: string) => (current.layout = next) }
}

function plainPress(key: string, code: string) {
  return { key, code, ctrlKey: false, altKey: false, metaKey: false, shiftKey: false }
}

describe('keyboard layout', () => {
  it('reads what each key types', async () => {
    const { keyboardLayoutKey, trackKeyboardLayout } = await loadWithKeyboard('azerty')

    trackKeyboardLayout()

    await vi.waitFor(() => expect(keyboardLayoutKey('KeyQ')).toBe('a'))
  })

  it('drops a stale map when a plain key press disagrees, then reads the new layout', async () => {
    const { keyboardLayoutKey, noteKeyboardLayoutKeyPress, trackKeyboardLayout, switchTo } =
      await loadWithKeyboard('us')
    trackKeyboardLayout()
    await vi.waitFor(() => expect(keyboardLayoutKey('KeyQ')).toBe('q'))

    switchTo('azerty')
    noteKeyboardLayoutKeyPress(plainPress('a', 'KeyQ'))

    // Until the new map arrives nothing is known, so callers use their layout-free rule.
    expect(keyboardLayoutKey('KeyQ')).toBeNull()
    await vi.waitFor(() => expect(keyboardLayoutKey('KeyQ')).toBe('a'))
  })

  it('keeps the map for presses that agree with it or carry modifiers', async () => {
    const { keyboardLayoutKey, noteKeyboardLayoutKeyPress, trackKeyboardLayout } =
      await loadWithKeyboard('us')
    trackKeyboardLayout()
    await vi.waitFor(() => expect(keyboardLayoutKey('KeyQ')).toBe('q'))

    noteKeyboardLayoutKeyPress(plainPress('Q', 'KeyQ'))
    noteKeyboardLayoutKeyPress({ ...plainPress('@', 'KeyQ'), ctrlKey: true, altKey: true })

    expect(keyboardLayoutKey('KeyQ')).toBe('q')
  })

  it('knows nothing where the Keyboard API is unavailable', async () => {
    const { keyboardLayoutKey, trackKeyboardLayout } = await import('../keyboard-layout')

    trackKeyboardLayout()

    expect(keyboardLayoutKey('KeyQ')).toBeNull()
  })
})

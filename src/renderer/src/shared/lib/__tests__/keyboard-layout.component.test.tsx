import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(() => {
  Reflect.deleteProperty(navigator, 'keyboard')
  vi.resetModules()
})

async function loadWithKeyboard(layouts: readonly (readonly [string, string])[][]) {
  const listeners: (() => void)[] = []
  let index = 0
  Object.defineProperty(navigator, 'keyboard', {
    configurable: true,
    value: {
      getLayoutMap: async () => new Map(layouts[Math.min(index, layouts.length - 1)]),
      addEventListener: (type: string, listener: () => void) => {
        if (type === 'layoutchange') listeners.push(listener)
      },
    },
  })
  const module = await import('../keyboard-layout')
  return {
    ...module,
    switchLayout: () => {
      index += 1
      for (const listener of listeners) listener()
    },
  }
}

describe('keyboard layout', () => {
  it('reads what each key types and follows a layout switch', async () => {
    const { keyboardLayoutKey, trackKeyboardLayout, switchLayout } = await loadWithKeyboard([
      [['KeyQ', 'a']],
      [['KeyQ', 'q']],
    ])

    trackKeyboardLayout()
    await vi.waitFor(() => expect(keyboardLayoutKey('KeyQ')).toBe('a'))

    switchLayout()
    await vi.waitFor(() => expect(keyboardLayoutKey('KeyQ')).toBe('q'))
  })

  it('knows nothing where the Keyboard API is unavailable', async () => {
    const { keyboardLayoutKey, trackKeyboardLayout } = await import('../keyboard-layout')

    trackKeyboardLayout()

    expect(keyboardLayoutKey('KeyQ')).toBeNull()
  })
})

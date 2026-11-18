import { describe, expect, it } from 'vitest'
import { typesAltGraphCharacter } from '../altgraph-character'

const altGr = { ctrl: true, alt: true, meta: false, shift: false, applePlatform: false } as const

function types(
  key: string,
  code: string,
  altGraph: boolean | null,
  options: { readonly shift?: boolean; readonly layoutKey?: string } = {},
) {
  return typesAltGraphCharacter({
    ...altGr,
    shift: options.shift ?? false,
    key,
    code,
    altGraph,
    ...options,
  })
}

describe('typesAltGraphCharacter', () => {
  it('treats a character AltGr produces as typing', () => {
    // Polish AltGr+L, German AltGr+Q for "@", AltGr+7 for "{", and AltGr+Shift+L for "Ł".
    expect(types('ł', 'KeyL', true, { layoutKey: 'l' })).toBe(true)
    expect(types('@', 'KeyQ', true, { layoutKey: 'q' })).toBe(true)
    expect(types('{', 'Digit7', true, { layoutKey: '7' })).toBe(true)
    expect(types('Ł', 'KeyL', true, { shift: true, layoutKey: 'l' })).toBe(true)
    // Without a layout map: the flag is known, or the character is outside ASCII.
    expect(types('@', 'KeyQ', true)).toBe(true)
    expect(types('€', 'KeyE', null)).toBe(true)
  })

  it('keeps a shortcut whose key typed its own character on a remapped layout', () => {
    // AZERTY: KeyQ types "a" and Digit1 types "&"; QWERTZ: KeyY types "z"; Dvorak: KeyN types "b".
    expect(types('a', 'KeyQ', true, { layoutKey: 'a' })).toBe(false)
    expect(types('&', 'Digit1', true, { layoutKey: '&' })).toBe(false)
    expect(types('z', 'KeyY', true, { layoutKey: 'z' })).toBe(false)
    expect(types('a', 'KeyQ', null)).toBe(false)
    expect(types('b', 'KeyN', null)).toBe(false)
    expect(types('l', 'KeyL', true)).toBe(false)
  })

  it('keeps shortcuts on non-Latin layouts and Shift+digit symbols', () => {
    // Russian Ctrl+Alt+B types "и" from KeyB without any AltGr.
    expect(types('и', 'KeyB', null)).toBe(false)
    expect(types('α', 'KeyA', true)).toBe(false)
    expect(types('!', 'Digit1', null, { shift: true })).toBe(false)
    expect(types('?', 'Slash', true, { shift: true, layoutKey: '/' })).toBe(false)
    expect(types('_', 'Minus', true, { shift: true })).toBe(false)
    expect(types('ArrowUp', 'ArrowUp', true)).toBe(false)
  })

  it('counts an ASCII symbol without a layout map only when the AltGr flag is known', () => {
    expect(types('{', 'BracketLeft', true)).toBe(true)
    expect(types('[', 'BracketLeft', null)).toBe(false)
    expect(types('&', 'Digit1', null)).toBe(false)
    expect(types(' ', 'Space', null)).toBe(false)
  })

  it('needs AltGr, or Ctrl+Alt without Meta when the flag is unknown', () => {
    expect(types('ł', 'KeyL', false)).toBe(false)
    expect(
      typesAltGraphCharacter({ ...altGr, meta: true, key: 'ł', code: 'KeyL', altGraph: null }),
    ).toBe(false)
    expect(
      typesAltGraphCharacter({ ...altGr, ctrl: false, key: 'ł', code: 'KeyL', altGraph: null }),
    ).toBe(false)
  })

  it('never counts macOS Option characters, so Cmd+Option shortcuts keep working', () => {
    expect(
      typesAltGraphCharacter({
        ...altGr,
        ctrl: false,
        meta: true,
        applePlatform: true,
        key: '¬',
        code: 'KeyL',
        altGraph: true,
      }),
    ).toBe(false)
  })
})

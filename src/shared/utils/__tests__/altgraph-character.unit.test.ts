import { describe, expect, it } from 'vitest'
import { typesAltGraphCharacter } from '../altgraph-character'

const altGr = { ctrl: true, alt: true, meta: false, shift: false, applePlatform: false } as const

function types(key: string, code: string, altGraph: boolean | null, shift = false) {
  return typesAltGraphCharacter({ ...altGr, shift, key, code, altGraph })
}

describe('typesAltGraphCharacter', () => {
  it('treats a character AltGr produces as typing', () => {
    // Polish AltGr+L, German AltGr+Q, AltGr+7 for "{", and AltGr+Shift+L for "Ł".
    expect(types('ł', 'KeyL', true)).toBe(true)
    expect(types('@', 'KeyQ', true)).toBe(true)
    expect(types('{', 'Digit7', true)).toBe(true)
    expect(types('Ł', 'KeyL', true, true)).toBe(true)
    // Windows main-process input, where Ctrl+Alt stands in for the missing flag.
    expect(types('€', 'KeyE', null)).toBe(true)
  })

  it('keeps a shortcut whose key gave no AltGr character', () => {
    expect(types('l', 'KeyL', true)).toBe(false)
    expect(types('L', 'KeyL', null)).toBe(false)
    expect(types('ArrowUp', 'ArrowUp', true)).toBe(false)
  })

  it('keeps shortcuts on non-Latin layouts and Shift+digit symbols', () => {
    // Russian Ctrl+Alt+B types "и" from KeyB without any AltGr.
    expect(types('и', 'KeyB', null)).toBe(false)
    expect(types('α', 'KeyA', true)).toBe(false)
    expect(types('!', 'Digit1', null, true)).toBe(false)
  })

  it('counts a key without a letter or digit of its own only when AltGr is known', () => {
    expect(types('{', 'BracketLeft', true)).toBe(true)
    expect(types('[', 'BracketLeft', null)).toBe(false)
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

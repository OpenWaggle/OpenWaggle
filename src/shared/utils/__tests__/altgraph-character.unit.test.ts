import { describe, expect, it } from 'vitest'
import { typesAltGraphCharacter } from '../altgraph-character'

const ctrlAlt = { ctrl: true, alt: true, meta: false, applePlatform: false } as const

describe('typesAltGraphCharacter', () => {
  it('treats a character AltGr produces as typing', () => {
    // Polish AltGr+L, German AltGr+Q, and AltGr+7 for "{".
    expect(typesAltGraphCharacter({ ...ctrlAlt, key: 'ł', code: 'KeyL', altGraph: true })).toBe(
      true,
    )
    expect(typesAltGraphCharacter({ ...ctrlAlt, key: '@', code: 'KeyQ', altGraph: true })).toBe(
      true,
    )
    expect(typesAltGraphCharacter({ ...ctrlAlt, key: '{', code: 'Digit7', altGraph: true })).toBe(
      true,
    )
    expect(typesAltGraphCharacter({ ...ctrlAlt, key: '€', code: 'KeyE', altGraph: null })).toBe(
      true,
    )
  })

  it('keeps a shortcut whose key gave no AltGr character', () => {
    expect(typesAltGraphCharacter({ ...ctrlAlt, key: 'l', code: 'KeyL', altGraph: true })).toBe(
      false,
    )
    expect(typesAltGraphCharacter({ ...ctrlAlt, key: 'L', code: 'KeyL', altGraph: null })).toBe(
      false,
    )
    expect(typesAltGraphCharacter({ ...ctrlAlt, key: 'b', code: 'KeyB', altGraph: true })).toBe(
      false,
    )
    expect(
      typesAltGraphCharacter({ ...ctrlAlt, key: 'ArrowUp', code: 'ArrowUp', altGraph: true }),
    ).toBe(false)
  })

  it('needs AltGr, or Ctrl+Alt without Meta when the flag is unknown', () => {
    expect(typesAltGraphCharacter({ ...ctrlAlt, key: 'ł', code: 'KeyL', altGraph: false })).toBe(
      false,
    )
    expect(
      typesAltGraphCharacter({ ...ctrlAlt, meta: true, key: 'ł', code: 'KeyL', altGraph: null }),
    ).toBe(false)
    expect(
      typesAltGraphCharacter({ ...ctrlAlt, ctrl: false, key: 'ł', code: 'KeyL', altGraph: null }),
    ).toBe(false)
  })

  it('never counts macOS Option characters, so Cmd+Option shortcuts keep working', () => {
    expect(
      typesAltGraphCharacter({
        ctrl: false,
        alt: true,
        meta: true,
        applePlatform: true,
        key: '¬',
        code: 'KeyL',
        altGraph: true,
      }),
    ).toBe(false)
  })
})

import { fromPartial } from '@total-typescript/shoehorn'
import type { Input } from 'electron'
import { describe, expect, it } from 'vitest'
import { browserPreviewShortcutBindingsMatchInput } from '../browser-preview-policy'

const BINDINGS = [
  { key: 'L', mod: true, alt: true },
  { key: 'B', mod: true, alt: true },
] as const

function input(key: string, code: string): Input {
  return fromPartial<Input>({
    type: 'keyDown',
    key,
    code,
    control: true,
    alt: true,
    meta: false,
    shift: false,
    isComposing: false,
  })
}

function claims(key: string, code: string, platform: NodeJS.Platform) {
  return browserPreviewShortcutBindingsMatchInput(input(key, code), BINDINGS, false, platform)
}

describe('browser preview shortcuts and AltGr', () => {
  it('leaves a character typed with AltGr on Windows to the page', () => {
    // AltGr+L types "ł" on a Polish keyboard; Windows reports it as Ctrl+Alt.
    expect(claims('ł', 'KeyL', 'win32')).toBe(false)
  })

  it('still claims Ctrl+Alt shortcuts that type no AltGr character', () => {
    expect(claims('l', 'KeyL', 'win32')).toBe(true)
    // A Russian layout gives "и" for KeyB without any AltGr.
    expect(claims('и', 'KeyB', 'win32')).toBe(true)
    // Dvorak types "b" on KeyN and "l" on KeyP; AZERTY types "l" on KeyL as QWERTY does.
    expect(claims('b', 'KeyN', 'win32')).toBe(true)
    expect(claims('l', 'KeyP', 'win32')).toBe(true)
  })

  it('claims the shortcut on Linux, which reports AltGr without Ctrl and Alt', () => {
    expect(claims('ł', 'KeyL', 'linux')).toBe(true)
  })
})

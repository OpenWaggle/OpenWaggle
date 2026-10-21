import { fromPartial } from '@total-typescript/shoehorn'
import type { Input } from 'electron'
import { describe, expect, it } from 'vitest'
import { browserPreviewShortcutBindingsMatchInput } from '../browser-preview-policy'

const COPY_SESSION_LINK = [{ key: 'L', mod: true, alt: true }] as const

function input(key: string): Input {
  return fromPartial<Input>({
    type: 'keyDown',
    key,
    code: 'KeyL',
    control: true,
    alt: true,
    meta: false,
    shift: false,
    isComposing: false,
  })
}

describe('browser preview shortcuts and AltGr', () => {
  it('leaves a character typed with AltGr to the page', () => {
    // AltGr+L types "ł" on a Polish keyboard; Windows reports it as Ctrl+Alt.
    expect(browserPreviewShortcutBindingsMatchInput(input('ł'), COPY_SESSION_LINK, false)).toBe(
      false,
    )
  })

  it('still claims Ctrl+Alt+L when it types no character', () => {
    expect(browserPreviewShortcutBindingsMatchInput(input('l'), COPY_SESSION_LINK, false)).toBe(
      true,
    )
  })
})

import { fromPartial } from '@total-typescript/shoehorn'
import type { Input, WebContents } from 'electron'
import { describe, expect, it, vi } from 'vitest'
import {
  isBrowserPreviewEditingShortcut,
  synchronizeBrowserPreviewEditingShortcuts,
} from '../browser-preview-editing-shortcuts'

function input(values: Partial<Input> = {}) {
  return fromPartial<Input>({
    type: 'keyDown',
    key: 'v',
    code: 'KeyV',
    meta: false,
    control: false,
    alt: false,
    shift: false,
    ...values,
  })
}

describe('preview editing shortcuts', () => {
  it.each(['darwin', 'linux', 'win32'] satisfies NodeJS.Platform[])(
    'preserves copy, cut, paste, select-all and undo on %s',
    (platform) => {
      for (const key of ['c', 'x', 'v', 'a', 'z']) {
        expect(
          isBrowserPreviewEditingShortcut(
            input({
              key,
              meta: platform === 'darwin',
              control: platform !== 'darwin',
            }),
            platform,
          ),
        ).toBe(true)
      }
    },
  )

  it('recognizes macOS paste-and-match-style by physical key', () => {
    expect(
      isBrowserPreviewEditingShortcut(
        input({
          key: '◊',
          meta: true,
          alt: true,
          shift: true,
        }),
        'darwin',
      ),
    ).toBe(true)
  })

  it('preserves platform-specific redo and plain-text paste', () => {
    expect(isBrowserPreviewEditingShortcut(input({ key: 'y', control: true }), 'win32')).toBe(true)
    expect(isBrowserPreviewEditingShortcut(input({ key: 'y', control: true }), 'linux')).toBe(false)
    expect(
      isBrowserPreviewEditingShortcut(input({ key: 'z', control: true, shift: true }), 'win32'),
    ).toBe(false)
    expect(
      isBrowserPreviewEditingShortcut(input({ key: 'z', control: true, shift: true }), 'linux'),
    ).toBe(true)
    expect(isBrowserPreviewEditingShortcut(input({ control: true, shift: true }), 'linux')).toBe(
      true,
    )
  })

  it('never routes background automation editing through the focused host menu', () => {
    const setIgnoreMenuShortcuts = vi.fn()
    const isFocused = vi.fn(() => false)
    const contents = fromPartial<WebContents>({ setIgnoreMenuShortcuts, isFocused })
    const paste = input({
      meta: process.platform === 'darwin',
      control: process.platform !== 'darwin',
    })
    synchronizeBrowserPreviewEditingShortcuts(contents, paste)
    expect(setIgnoreMenuShortcuts).toHaveBeenLastCalledWith(true)
    isFocused.mockReturnValue(true)
    synchronizeBrowserPreviewEditingShortcuts(contents, paste)
    expect(setIgnoreMenuShortcuts).toHaveBeenLastCalledWith(false)
    synchronizeBrowserPreviewEditingShortcuts(contents, { ...paste, key: 'q' })
    expect(setIgnoreMenuShortcuts).toHaveBeenLastCalledWith(true)
  })
})

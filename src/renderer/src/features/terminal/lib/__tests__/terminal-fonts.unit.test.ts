import { describe, expect, it, vi } from 'vitest'
import {
  createTerminalSymbolsFontLoader,
  TERMINAL_SYMBOL_FONT_FAMILY,
  terminalFontFamilyWithSymbols,
} from '../terminal-fonts'

describe('terminalFontFamilyWithSymbols', () => {
  it('keeps the user-selected text stack ahead of every symbol fallback', () => {
    const family = terminalFontFamilyWithSymbols('"Iosevka", ui-monospace')

    expect(family.startsWith('"Iosevka", ui-monospace, "Symbols Nerd Font Mono"')).toBe(true)
    expect(family).toContain('"PowerlineSymbols"')
    expect(family.endsWith('monospace')).toBe(true)
  })

  it('uses symbol and system fallback faces when the requested stack is empty', () => {
    expect(terminalFontFamilyWithSymbols('  ')).toMatch(
      /^"Symbols Nerd Font Mono".*"PowerlineSymbols", monospace$/u,
    )
  })
})

describe('createTerminalSymbolsFontLoader', () => {
  it('loads and registers the bundled face once across concurrent callers', async () => {
    const loadedFace = { load: vi.fn() }
    loadedFace.load.mockResolvedValue(loadedFace)
    const createFace = vi.fn(() => loadedFace)
    const addFace = vi.fn()
    const load = createTerminalSymbolsFontLoader({ createFace, addFace })

    const results = await Promise.all([load(), load()])

    expect(results.map((result) => result.status)).toEqual(['bundled', 'bundled'])
    expect(results[0]?.attribution.licenseNotice).toContain('Copyright (c) 2014 Ryan L McIntyre')
    expect(createFace).toHaveBeenCalledOnce()
    expect(createFace).toHaveBeenCalledWith(
      TERMINAL_SYMBOL_FONT_FAMILY,
      expect.stringMatching(/^url\(.+\.woff2\)$/u),
    )
    expect(addFace).toHaveBeenCalledBefore(loadedFace.load)
    expect(loadedFace.load).toHaveBeenCalledOnce()
    expect(addFace).toHaveBeenCalledOnce()
    expect(addFace).toHaveBeenCalledWith(loadedFace)
  })

  it('retains local fallbacks when the bundled face cannot load', async () => {
    const failedFace = { load: vi.fn().mockRejectedValue(new Error('font decoding unavailable')) }
    const createFace = vi.fn(() => failedFace)
    const addFace = vi.fn()
    const removeFace = vi.fn()
    const load = createTerminalSymbolsFontLoader({ createFace, addFace, removeFace })

    await expect(load()).resolves.toMatchObject({ status: 'local-fallback-only' })
    expect(addFace).toHaveBeenCalledExactlyOnceWith(failedFace)
    expect(removeFace).toHaveBeenCalledExactlyOnceWith(failedFace)
  })
})

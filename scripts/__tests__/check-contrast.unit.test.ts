import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { DEFAULT_EXTENSION_THEME_TOKENS } from '../../packages/extension-sdk/src/theme-data.js'
import {
  PUBLIC_COLOR_ROLES,
  checkContrastGate,
  contrastRatio,
  findContrastFailures,
  parseHexColor,
} from '../check-contrast'

const GLOBALS_CSS_URL = new URL('../../src/renderer/src/styles/globals.css', import.meta.url)

describe('ADR 0024 contrast gate', () => {
  it('parses six-digit hex colors', () => {
    expect(parseHexColor('#00aAFF')).toEqual({ red: 0, green: 170, blue: 255 })
    expect(() => parseHexColor('#fff')).toThrow('Invalid six-digit hex color: #fff')
    expect(() => parseHexColor('not-a-color')).toThrow('Invalid six-digit hex color: not-a-color')
  })

  it('calculates the same ratio regardless of color ordering', () => {
    expect(contrastRatio('#ffffff', '#000000')).toBe(21)
    expect(contrastRatio('#000000', '#ffffff')).toBe(21)
  })

  it('reports failing text and non-text roles against the active surface', () => {
    const colors = {
      ...DEFAULT_EXTENSION_THEME_TOKENS.color,
      accent: DEFAULT_EXTENSION_THEME_TOKENS.color.surfaceActive,
      danger: DEFAULT_EXTENSION_THEME_TOKENS.color.surfaceActive,
    }

    expect(findContrastFailures(colors)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ role: 'accent', surface: 'surfaceActive', floor: 4.5 }),
        expect.objectContaining({ role: 'danger', surface: 'surfaceActive', floor: 3 }),
      ]),
    )
  })

  it('reports missing and mismatched host source variables', () => {
    const css = readFileSync(GLOBALS_CSS_URL, 'utf8')
    const missing = css.replace('  --color-info: #3b82f6;\n', '')
    const mismatched = css.replace('  --color-warning: #f97316;', '  --color-warning: #ffffff;')

    expect(checkContrastGate(missing)).toContain(
      'Host variable --color-info for info is missing or unresolved',
    )
    expect(checkContrastGate(mismatched)).toContain(
      'Host variable --color-warning for warning is #ffffff; SDK default is #f97316',
    )
  })

  it('passes the current 23-role SDK and host defaults', () => {
    expect(PUBLIC_COLOR_ROLES).toHaveLength(23)
    expect(checkContrastGate(readFileSync(GLOBALS_CSS_URL, 'utf8'))).toEqual([])
  })
})

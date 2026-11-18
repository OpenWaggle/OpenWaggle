import {
  DEFAULT_APPEARANCE_TERMINAL_PALETTE,
  normalizeTerminalPaletteColor,
} from '@shared/types/appearance-preferences'
import { DEFAULT_SYNTAX_THEME_SELECTIONS } from '@shared/types/syntax'
import type { SyntaxThemeResource } from '@shared/types/syntax-resources'
import { describe, expect, it } from 'vitest'
import { testHexColor as hex } from '@/test-utils/test-color'
import { resolveTerminalPalette, type TerminalPalette } from '../terminal-palette'

const FALLBACK: TerminalPalette = {
  background: hex('101010'),
  foreground: hex('f0f0f0'),
  cursor: hex('ffaa00'),
  selection: hex('ffaa0044'),
  scrollbar: hex('99999977'),
}

const IMPORTED_THEME: SyntaxThemeResource = {
  id: 'theme:test:dark',
  packageId: 'test',
  revision: 'revision-1',
  label: 'Test VS Code theme',
  variant: 'dark',
  scope: 'user',
  format: 'vscode-json',
  sourcePath: '/tmp/theme.json',
  theme: {
    name: 'test-theme',
    displayName: 'Test VS Code theme',
    type: 'dark',
    colors: {
      'editor.background': hex('202124'),
      'editor.foreground': hex('f8f9fa'),
      'terminal.background': hex('111213'),
      'terminal.foreground': hex('dedede'),
      'terminalCursor.foreground': hex('ABC'),
      'terminal.selectionBackground': hex('44556688'),
      'scrollbarSlider.background': hex('77889966'),
      'terminal.ansiRed': hex('ee3322'),
    },
    settings: [],
  },
  original: {},
}

function resolve(overrides = DEFAULT_APPEARANCE_TERMINAL_PALETTE) {
  return resolveTerminalPalette({
    appearance: 'dark',
    overrides,
    selections: { ...DEFAULT_SYNTAX_THEME_SELECTIONS, dark: IMPORTED_THEME.id },
    resources: [IMPORTED_THEME],
    fallback: FALLBACK,
  })
}

describe('terminal palette resolution', () => {
  it('preserves VS Code terminal roles and their original ANSI color map', () => {
    const resolved = resolve()

    expect(resolved.palette).toEqual({
      background: hex('111213'),
      foreground: hex('dedede'),
      cursor: hex('aabbcc'),
      selection: hex('44556688'),
      scrollbar: hex('77889966'),
    })
    expect(resolved.source).toEqual({
      background: 'theme',
      foreground: 'theme',
      cursor: 'theme',
      selection: 'theme',
      scrollbar: 'theme',
    })
    expect(resolved.themeColors['terminal.ansiRed']).toBe(hex('ee3322'))
  })

  it('layers validated custom roles above the active theme', () => {
    const resolved = resolve({
      ...DEFAULT_APPEARANCE_TERMINAL_PALETTE,
      background: hex('F0A'),
      cursor: hex('123456cc'),
    })

    expect(resolved.palette.background).toBe(hex('ff00aa'))
    expect(resolved.palette.cursor).toBe(hex('123456cc'))
    expect(resolved.palette.foreground).toBe(hex('dedede'))
    expect(resolved.source.background).toBe('custom')
    expect(resolved.source.foreground).toBe('theme')
  })

  it('falls back safely when an imported theme contains invalid CSS colors', () => {
    const unsafeTheme: SyntaxThemeResource = {
      ...IMPORTED_THEME,
      theme: {
        ...IMPORTED_THEME.theme,
        colors: {
          'terminal.background': 'url(javascript:alert(1))',
          'terminal.foreground': 'not-a-color',
        },
      },
    }
    const resolved = resolveTerminalPalette({
      appearance: 'dark',
      overrides: DEFAULT_APPEARANCE_TERMINAL_PALETTE,
      selections: { ...DEFAULT_SYNTAX_THEME_SELECTIONS, dark: unsafeTheme.id },
      resources: [unsafeTheme],
      fallback: FALLBACK,
    })

    expect(resolved.palette.background).toBe(FALLBACK.background)
    expect(resolved.palette.foreground).toBe(FALLBACK.foreground)
    expect(resolved.source.background).toBe('appearance')
  })

  it('normalizes supported CSS hex forms and rejects other CSS values', () => {
    expect(normalizeTerminalPaletteColor(` ${hex('AbC')} `)).toBe(hex('aabbcc'))
    expect(normalizeTerminalPaletteColor(hex('abcd'))).toBe(hex('aabbccdd'))
    expect(normalizeTerminalPaletteColor(hex('AABBCCDD'))).toBe(hex('aabbccdd'))
    expect(normalizeTerminalPaletteColor('red')).toBeNull()
    expect(normalizeTerminalPaletteColor(hex('12345'))).toBeNull()
  })
})

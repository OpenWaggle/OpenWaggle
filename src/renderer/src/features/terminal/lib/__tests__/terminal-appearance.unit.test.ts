import {
  DEFAULT_APPEARANCE_PREFERENCES,
  DEFAULT_APPEARANCE_TERMINAL_PALETTE,
} from '@shared/types/appearance-preferences'
import { DEFAULT_SYNTAX_THEME_SELECTIONS } from '@shared/types/syntax'
import type { SyntaxThemeResource } from '@shared/types/syntax-resources'
// @vitest-environment jsdom

import { fromPartial } from '@total-typescript/shoehorn'
import type { ITheme } from '@xterm/xterm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setRuntimeAppearancePreferences } from '@/shared/lib/appearance-preferences-runtime'
import {
  setRuntimeSyntaxThemeResources,
  setRuntimeSyntaxThemeSelections,
} from '@/shared/lib/syntax/syntax-theme-runtime'
import { testHexColor as hex } from '@/test-utils/test-color'
import { observeTerminalAppearance, readTerminalAppearance } from '../terminal-appearance'

function importedTheme(id: string, terminalBackground: string): SyntaxThemeResource {
  return {
    id,
    packageId: 'palette-test',
    revision: `${id}-revision`,
    label: id,
    variant: 'dark',
    scope: 'user',
    format: 'vscode-json',
    sourcePath: `/tmp/${id}.json`,
    theme: {
      name: id,
      displayName: id,
      type: 'dark',
      colors: {
        'terminal.background': terminalBackground,
        'terminal.foreground': hex('d4d4d4'),
        'terminalCursor.foreground': hex('ffcc00'),
        'terminal.selectionBackground': hex('33669988'),
        'scrollbarSlider.background': hex('77889977'),
        'terminal.ansiRed': hex('de3344'),
        'terminal.ansiBrightBlue': hex('66aaff'),
      },
      settings: [],
    },
    original: {},
  }
}

const FIRST_THEME = importedTheme('theme:first:dark', hex('191919'))
const SECOND_THEME = importedTheme('theme:second:dark', hex('292929'))

function installAppearanceTokens() {
  const root = document.documentElement
  root.dataset.theme = 'dark'
  root.style.setProperty('--color-bg', hex('101010'))
  root.style.setProperty('--color-text-primary', hex('eeeeee'))
  root.style.setProperty('--color-text-secondary', hex('cccccc'))
  root.style.setProperty('--color-text-muted', hex('888888'))
  root.style.setProperty('--color-accent', hex('ffaa00'))
  root.style.setProperty('--color-diff-bg', hex('090909'))
  root.style.setProperty('--color-error', hex('ff4444'))
  root.style.setProperty('--color-error-text', hex('ff8888'))
  root.style.setProperty('--color-success', hex('44bb77'))
  root.style.setProperty('--color-info', hex('4488ff'))
  root.style.setProperty('--color-info-text', hex('77aaff'))
  root.style.setProperty('--color-review', hex('aa88ff'))
  root.style.setProperty('--color-plan', hex('ee88ff'))
  root.style.setProperty('--color-progress', hex('77ddff'))
  root.style.setProperty('--font-terminal', 'monospace')
  root.style.setProperty('--font-terminal-size', '14px')
}

describe('terminal appearance', () => {
  beforeEach(() => {
    installAppearanceTokens()
    setRuntimeAppearancePreferences(DEFAULT_APPEARANCE_PREFERENCES)
    setRuntimeSyntaxThemeSelections({
      ...DEFAULT_SYNTAX_THEME_SELECTIONS,
      dark: FIRST_THEME.id,
    })
    setRuntimeSyntaxThemeResources([FIRST_THEME, SECOND_THEME])
  })

  afterEach(() => {
    document.documentElement.removeAttribute('data-theme')
    document.documentElement.removeAttribute('style')
    setRuntimeAppearancePreferences(DEFAULT_APPEARANCE_PREFERENCES)
    setRuntimeSyntaxThemeSelections(DEFAULT_SYNTAX_THEME_SELECTIONS)
    setRuntimeSyntaxThemeResources([])
  })

  it('maps imported terminal, scrollbar, and ANSI colors into xterm', () => {
    const appearance = readTerminalAppearance()

    expect(appearance.theme).toMatchObject({
      background: hex('191919'),
      foreground: hex('d4d4d4'),
      cursor: hex('ffcc00'),
      cursorAccent: hex('191919'),
      selectionBackground: hex('33669988'),
      scrollbarSliderBackground: hex('77889977'),
      red: hex('de3344'),
      brightBlue: hex('66aaff'),
    })
  })

  it('applies and removes terminal-only runtime overrides', () => {
    setRuntimeAppearancePreferences({
      ...DEFAULT_APPEARANCE_PREFERENCES,
      terminalPalette: {
        ...DEFAULT_APPEARANCE_TERMINAL_PALETTE,
        cursor: hex('00ffaa'),
        scrollbar: hex('11223399'),
      },
    })

    expect(readTerminalAppearance().theme).toMatchObject({
      cursor: hex('00ffaa'),
      scrollbarSliderBackground: hex('11223399'),
    })
    expect(document.documentElement.style.getPropertyValue('--terminal-cursor-override')).toBe(
      hex('00ffaa'),
    )

    setRuntimeAppearancePreferences(DEFAULT_APPEARANCE_PREFERENCES)

    expect(readTerminalAppearance().theme.cursor).toBe(hex('ffcc00'))
    expect(document.documentElement.style.getPropertyValue('--terminal-cursor-override')).toBe('')
  })

  it('live-updates mounted xterm options when the selected theme changes', () => {
    const terminal = { options: fromPartial<{ theme?: ITheme }>({}) }
    const refit = vi.fn()
    const dispose = observeTerminalAppearance(terminal, refit)

    setRuntimeSyntaxThemeSelections({
      ...DEFAULT_SYNTAX_THEME_SELECTIONS,
      dark: SECOND_THEME.id,
    })

    expect(terminal.options.theme?.background).toBe(hex('292929'))
    expect(refit).toHaveBeenCalledOnce()

    dispose()
    setRuntimeSyntaxThemeSelections(DEFAULT_SYNTAX_THEME_SELECTIONS)
    expect(refit).toHaveBeenCalledOnce()
  })
})

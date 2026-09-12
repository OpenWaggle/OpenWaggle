import { DEFAULT_APPEARANCE_TERMINAL_PALETTE } from '@shared/types/appearance-preferences'
import { DEFAULT_SETTINGS } from '@shared/types/settings'
import { DEFAULT_SYNTAX_THEME_SELECTIONS } from '@shared/types/syntax'
import type { SyntaxThemeResource } from '@shared/types/syntax-resources'
import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { usePreferencesStore } from '@/features/settings/state'
import {
  setRuntimeSyntaxThemeResources,
  setRuntimeSyntaxThemeSelections,
} from '@/shared/lib/syntax/syntax-theme-runtime'
import { testHexColor } from '@/test-utils/test-color'
import { TerminalPaletteSettings } from '../sections/TerminalPaletteSettings'

const THEME_BACKGROUND = testHexColor('101820')
const THEME_FOREGROUND = testHexColor('e8edf2')
const THEME_CURSOR = testHexColor('f5a623')
const THEME_SELECTION = testHexColor('31537a88')
const THEME_SCROLLBAR = testHexColor('8190a066')

const THEME: SyntaxThemeResource = {
  id: 'theme:component:dark',
  packageId: 'component',
  revision: 'revision-1',
  label: 'Component theme',
  variant: 'dark',
  scope: 'user',
  format: 'vscode-json',
  sourcePath: '/tmp/component-theme.json',
  theme: {
    name: 'component-theme',
    displayName: 'Component theme',
    type: 'dark',
    colors: {
      'terminal.background': THEME_BACKGROUND,
      'terminal.foreground': THEME_FOREGROUND,
      'terminalCursor.foreground': THEME_CURSOR,
      'terminal.selectionBackground': THEME_SELECTION,
      'scrollbarSlider.background': THEME_SCROLLBAR,
    },
    settings: [],
  },
  original: {},
}

function installTheme() {
  document.documentElement.dataset.theme = 'dark'
  document.documentElement.style.setProperty('--color-bg', testHexColor('141719'))
  document.documentElement.style.setProperty('--color-text-primary', testHexColor('e7e9ee'))
  document.documentElement.style.setProperty('--color-text-muted', testHexColor('8f98a8'))
  document.documentElement.style.setProperty('--color-accent', THEME_CURSOR)
  setRuntimeSyntaxThemeSelections({ ...DEFAULT_SYNTAX_THEME_SELECTIONS, dark: THEME.id })
  setRuntimeSyntaxThemeResources([THEME])
}

describe('TerminalPaletteSettings', () => {
  const setPalette = vi.fn().mockResolvedValue(undefined)

  beforeEach(() => {
    vi.clearAllMocks()
    installTheme()
    usePreferencesStore.setState({
      ...usePreferencesStore.getInitialState(),
      settings: DEFAULT_SETTINGS,
      setAppearanceTerminalPalette: setPalette,
    })
  })

  afterEach(() => {
    document.documentElement.removeAttribute('data-theme')
    document.documentElement.removeAttribute('style')
    setRuntimeSyntaxThemeSelections(DEFAULT_SYNTAX_THEME_SELECTIONS)
    setRuntimeSyntaxThemeResources([])
  })

  it('shows all terminal roles in one accessible live specimen', () => {
    render(<TerminalPaletteSettings />)

    expect(
      screen.getByRole('img', {
        name: 'Live terminal color preview with prompt, selection, cursor, and scrollbar',
      }),
    ).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Background hex color' })).toHaveValue(
      THEME_BACKGROUND,
    )
    expect(screen.getByRole('textbox', { name: 'Foreground hex color' })).toHaveValue(
      THEME_FOREGROUND,
    )
    expect(screen.getByRole('textbox', { name: 'Cursor hex color' })).toHaveValue(THEME_CURSOR)
    expect(screen.getByRole('textbox', { name: 'Selection hex color' })).toHaveValue(
      THEME_SELECTION,
    )
    expect(screen.getByRole('textbox', { name: 'Scrollbar hex color' })).toHaveValue(
      THEME_SCROLLBAR,
    )
  })

  it('validates typed colors inline before persisting a normalized override', () => {
    render(<TerminalPaletteSettings />)
    const input = screen.getByRole('textbox', { name: 'Foreground hex color' })

    fireEvent.change(input, { target: { value: 'not a color' } })
    fireEvent.blur(input)

    expect(screen.getByRole('alert')).toHaveTextContent('Enter a 3, 4, 6, or 8 digit hex color')
    expect(setPalette).not.toHaveBeenCalled()

    fireEvent.change(input, { target: { value: testHexColor('AbC') } })
    fireEvent.blur(input)

    expect(setPalette).toHaveBeenCalledWith({ foreground: testHexColor('aabbcc') })
  })

  it('resets one override or the entire palette back to theme values', () => {
    usePreferencesStore.setState({
      settings: {
        ...DEFAULT_SETTINGS,
        appearancePreferences: {
          ...DEFAULT_SETTINGS.appearancePreferences,
          terminalPalette: {
            ...DEFAULT_APPEARANCE_TERMINAL_PALETTE,
            background: testHexColor('222222'),
            cursor: testHexColor('00ff00'),
          },
        },
      },
    })
    render(<TerminalPaletteSettings />)

    fireEvent.click(screen.getByRole('button', { name: 'Reset Background to theme' }))
    expect(setPalette).toHaveBeenCalledWith({ background: null })

    fireEvent.click(screen.getByRole('button', { name: 'Reset to theme' }))
    expect(setPalette).toHaveBeenCalledWith(DEFAULT_APPEARANCE_TERMINAL_PALETTE)
  })
})

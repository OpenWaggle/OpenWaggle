import { normalizeTerminalPaletteColor } from '@shared/types/appearance-preferences'
import type { ITheme } from '@xterm/xterm'
import { useAppearancePreferencesRuntimeStore } from '@/shared/lib/appearance-preferences-runtime'
import { useSyntaxThemeRuntimeStore } from '@/shared/lib/syntax/syntax-theme-runtime'
import { readTerminalPalette } from '@/shared/lib/terminal-palette'
import { terminalFontFamilyWithSymbols } from './terminal-fonts'

export const DEFAULT_TERMINAL_FONT_SIZE = 14

const ANSI_THEME_ENTRIES = [
  ['black', 'terminal.ansiBlack'],
  ['red', 'terminal.ansiRed'],
  ['green', 'terminal.ansiGreen'],
  ['yellow', 'terminal.ansiYellow'],
  ['blue', 'terminal.ansiBlue'],
  ['magenta', 'terminal.ansiMagenta'],
  ['cyan', 'terminal.ansiCyan'],
  ['white', 'terminal.ansiWhite'],
  ['brightBlack', 'terminal.ansiBrightBlack'],
  ['brightRed', 'terminal.ansiBrightRed'],
  ['brightGreen', 'terminal.ansiBrightGreen'],
  ['brightYellow', 'terminal.ansiBrightYellow'],
  ['brightBlue', 'terminal.ansiBrightBlue'],
  ['brightMagenta', 'terminal.ansiBrightMagenta'],
  ['brightCyan', 'terminal.ansiBrightCyan'],
  ['brightWhite', 'terminal.ansiBrightWhite'],
] as const

type AnsiThemeRole = (typeof ANSI_THEME_ENTRIES)[number][0]

export interface TerminalAppearance {
  readonly theme: ITheme
  readonly fontFamily: string
  readonly fontSize: number
}

function importedAnsiTheme(
  colors: Readonly<Record<string, string>>,
): Partial<Pick<ITheme, AnsiThemeRole>> {
  const theme: Partial<Pick<ITheme, AnsiThemeRole>> = {}
  for (const [role, key] of ANSI_THEME_ENTRIES) {
    const color = normalizeTerminalPaletteColor(colors[key])
    if (color !== null) theme[role] = color
  }
  return theme
}

/** Maps OpenWaggle's semantic CSS custom properties onto xterm's theme shape. */
export function readTerminalAppearance(): TerminalAppearance {
  const styles = getComputedStyle(document.documentElement)
  const color = (name: string) => styles.getPropertyValue(name).trim()
  const accent = color('--color-accent')
  const terminal = readTerminalPalette()
  const theme: ITheme = {
    background: terminal.palette.background,
    foreground: terminal.palette.foreground,
    cursor: terminal.palette.cursor,
    cursorAccent: terminal.palette.background,
    selectionBackground: terminal.palette.selection,
    scrollbarSliderBackground: terminal.palette.scrollbar,
    black: color('--color-diff-bg'),
    red: color('--color-error'),
    green: color('--color-success'),
    yellow: accent,
    blue: color('--color-info'),
    magenta: color('--color-review'),
    cyan: color('--color-progress'),
    white: color('--color-text-secondary'),
    brightBlack: color('--color-text-muted'),
    brightRed: color('--color-error-text'),
    brightGreen: color('--color-success'),
    brightYellow: accent,
    brightBlue: color('--color-info-text'),
    brightMagenta: color('--color-plan'),
    brightCyan: color('--color-progress'),
    brightWhite: color('--color-text-primary'),
    ...importedAnsiTheme(terminal.themeColors),
  }

  const fontSize = Number.parseFloat(styles.getPropertyValue('--font-terminal-size'))
  return {
    fontFamily: terminalFontFamilyWithSymbols(styles.getPropertyValue('--font-terminal').trim()),
    fontSize: Number.isFinite(fontSize) ? fontSize : DEFAULT_TERMINAL_FONT_SIZE,
    theme,
  }
}

/** Live-updates a terminal's appearance from OpenWaggle's design tokens. */
export function observeTerminalAppearance(
  term: {
    options: { theme?: ITheme; fontFamily?: string; fontSize?: number }
  },
  refit: () => void,
): () => void {
  const apply = () => {
    const appearance = readTerminalAppearance()
    term.options.theme = appearance.theme
    term.options.fontFamily = appearance.fontFamily
    term.options.fontSize = appearance.fontSize
    refit()
  }
  const observer = new MutationObserver(apply)
  observer.observe(document.documentElement, {
    attributeFilter: ['data-theme', 'style'],
    attributes: true,
  })
  const unsubscribeAppearance = useAppearancePreferencesRuntimeStore.subscribe(apply)
  const unsubscribeSyntax = useSyntaxThemeRuntimeStore.subscribe(apply)
  document.fonts?.addEventListener('loadingdone', apply)
  return () => {
    observer.disconnect()
    unsubscribeAppearance()
    unsubscribeSyntax()
    document.fonts?.removeEventListener('loadingdone', apply)
  }
}

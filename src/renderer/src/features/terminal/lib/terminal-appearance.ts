import type { ITheme } from '@xterm/xterm'

const TERMINAL_SELECTION_OPACITY = 0.3
export const DEFAULT_TERMINAL_FONT_SIZE = 14

function colorWithOpacity(color: string, opacity: number) {
  const context = document.createElement('canvas').getContext('2d')
  if (context === null) return color

  context.fillStyle = color
  context.fillRect(0, 0, 1, 1)
  const [red, green, blue] = context.getImageData(0, 0, 1, 1).data
  return `rgba(${red}, ${green}, ${blue}, ${opacity})`
}

export interface TerminalAppearance {
  readonly theme: ITheme
  readonly fontFamily: string
  readonly fontSize: number
}

/** Maps OpenWaggle's semantic CSS custom properties onto xterm's theme shape. */
export function readTerminalAppearance(): TerminalAppearance {
  const styles = getComputedStyle(document.documentElement)
  const color = (name: string) => styles.getPropertyValue(name).trim()
  const accent = color('--color-accent')
  const theme: ITheme = {
    background: color('--color-bg'),
    foreground: color('--color-text-primary'),
    cursor: accent,
    selectionBackground: colorWithOpacity(accent, TERMINAL_SELECTION_OPACITY),
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
  }

  const fontSize = Number.parseFloat(styles.getPropertyValue('--font-terminal-size'))
  return {
    fontFamily: styles.getPropertyValue('--font-terminal').trim(),
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
  document.fonts.addEventListener('loadingdone', apply)
  return () => {
    observer.disconnect()
    document.fonts.removeEventListener('loadingdone', apply)
  }
}

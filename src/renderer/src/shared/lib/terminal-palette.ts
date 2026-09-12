import {
  type AppearanceTerminalPalettePreferences,
  normalizeTerminalPaletteColor,
  type TerminalPaletteRole,
} from '@shared/types/appearance-preferences'
import {
  bundledSyntaxTheme,
  type SyntaxAppearanceVariant,
  type SyntaxThemeSelections,
} from '@shared/types/syntax'
import type { SyntaxThemeResource } from '@shared/types/syntax-resources'
import { useAppearancePreferencesRuntimeStore } from './appearance-preferences-runtime'
import { useSyntaxThemeRuntimeStore } from './syntax/syntax-theme-runtime'

const TERMINAL_SELECTION_OPACITY = 0.3
const TERMINAL_SCROLLBAR_OPACITY = 0.45
const HEX_RADIX = 16
const HEX_RED_START = 1
const HEX_RED_END = 3
const HEX_GREEN_START = 3
const HEX_GREEN_END = 5
const HEX_BLUE_START = 5
const HEX_BLUE_END = 7

const THEME_ROLE_KEYS: Readonly<Record<TerminalPaletteRole, readonly string[]>> = {
  background: ['terminal.background', 'editor.background'],
  foreground: ['terminal.foreground', 'editor.foreground'],
  cursor: ['terminalCursor.foreground', 'editorCursor.foreground'],
  selection: ['terminal.selectionBackground', 'editor.selectionBackground'],
  scrollbar: ['scrollbarSlider.background'],
}

export interface TerminalPalette {
  readonly background: string
  readonly foreground: string
  readonly cursor: string
  readonly selection: string
  readonly scrollbar: string
}

export type TerminalPaletteSource = 'custom' | 'theme' | 'appearance'

export interface TerminalPaletteResolution {
  readonly palette: TerminalPalette
  readonly source: Readonly<Record<TerminalPaletteRole, TerminalPaletteSource>>
  readonly themeColors: Readonly<Record<string, string>>
}

interface ResolveTerminalPaletteInput {
  readonly appearance: string
  readonly overrides: AppearanceTerminalPalettePreferences
  readonly selections: SyntaxThemeSelections
  readonly resources: readonly SyntaxThemeResource[]
  readonly fallback: TerminalPalette
}

function appearanceVariant(appearance: string): SyntaxAppearanceVariant {
  if (appearance === 'light') return 'light'
  if (appearance === 'high-contrast-light') return 'high-contrast-light'
  if (appearance === 'high-contrast-dark') return 'high-contrast-dark'
  return 'dark'
}

function activeTheme(input: ResolveTerminalPaletteInput) {
  const themeId = input.selections[appearanceVariant(input.appearance)]
  return {
    bundled: bundledSyntaxTheme(themeId),
    imported: input.resources.find((resource) => resource.id === themeId),
  }
}

function firstThemeColor(colors: Readonly<Record<string, string>>, keys: readonly string[]) {
  for (const key of keys) {
    const color = normalizeTerminalPaletteColor(colors[key])
    if (color !== null) return color
  }
  return null
}

function resolveThemePalette(input: ResolveTerminalPaletteInput) {
  const { bundled, imported } = activeTheme(input)
  const colors = imported?.theme.colors ?? {}
  return {
    colors,
    palette: {
      background:
        firstThemeColor(colors, THEME_ROLE_KEYS.background) ?? bundled?.preview.background ?? null,
      foreground:
        firstThemeColor(colors, THEME_ROLE_KEYS.foreground) ?? bundled?.preview.foreground ?? null,
      cursor: firstThemeColor(colors, THEME_ROLE_KEYS.cursor),
      selection: firstThemeColor(colors, THEME_ROLE_KEYS.selection),
      scrollbar: firstThemeColor(colors, THEME_ROLE_KEYS.scrollbar),
    },
  }
}

function resolveRole(
  role: TerminalPaletteRole,
  input: ResolveTerminalPaletteInput,
  themePalette: Readonly<Record<TerminalPaletteRole, string | null>>,
) {
  const custom = normalizeTerminalPaletteColor(input.overrides[role])
  if (custom !== null) return { color: custom, source: 'custom' as const }
  const themed = themePalette[role]
  if (themed !== null) return { color: themed, source: 'theme' as const }
  return { color: input.fallback[role], source: 'appearance' as const }
}

export function resolveTerminalPalette(
  input: ResolveTerminalPaletteInput,
): TerminalPaletteResolution {
  const theme = resolveThemePalette(input)
  const background = resolveRole('background', input, theme.palette)
  const foreground = resolveRole('foreground', input, theme.palette)
  const cursor = resolveRole('cursor', input, theme.palette)
  const selection = resolveRole('selection', input, theme.palette)
  const scrollbar = resolveRole('scrollbar', input, theme.palette)
  return {
    palette: {
      background: background.color,
      foreground: foreground.color,
      cursor: cursor.color,
      selection: selection.color,
      scrollbar: scrollbar.color,
    },
    source: {
      background: background.source,
      foreground: foreground.source,
      cursor: cursor.source,
      selection: selection.source,
      scrollbar: scrollbar.source,
    },
    themeColors: theme.colors,
  }
}

function colorWithOpacity(color: string, opacity: number) {
  const normalized = normalizeTerminalPaletteColor(color)
  if (normalized === null) return color
  const red = Number.parseInt(normalized.slice(HEX_RED_START, HEX_RED_END), HEX_RADIX)
  const green = Number.parseInt(normalized.slice(HEX_GREEN_START, HEX_GREEN_END), HEX_RADIX)
  const blue = Number.parseInt(normalized.slice(HEX_BLUE_START, HEX_BLUE_END), HEX_RADIX)
  return `rgba(${red}, ${green}, ${blue}, ${opacity})`
}

export function readTerminalPaletteFallback(styles = getComputedStyle(document.documentElement)) {
  const color = (name: string) => styles.getPropertyValue(name).trim()
  const accent = color('--color-accent')
  return {
    background: color('--color-bg'),
    foreground: color('--color-text-primary'),
    cursor: accent,
    selection: colorWithOpacity(accent, TERMINAL_SELECTION_OPACITY),
    scrollbar: colorWithOpacity(color('--color-text-muted'), TERMINAL_SCROLLBAR_OPACITY),
  } satisfies TerminalPalette
}

export function readTerminalPalette(): TerminalPaletteResolution {
  const syntax = useSyntaxThemeRuntimeStore.getState()
  return resolveTerminalPalette({
    appearance: document.documentElement.getAttribute('data-theme') ?? 'dark',
    overrides: useAppearancePreferencesRuntimeStore.getState().preferences.terminalPalette,
    selections: syntax.selections,
    resources: syntax.resources,
    fallback: readTerminalPaletteFallback(),
  })
}

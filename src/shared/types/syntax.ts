/** App appearance slots that independently select a syntax theme. */
export const SYNTAX_APPEARANCE_VARIANTS = [
  'light',
  'dark',
  'high-contrast-light',
  'high-contrast-dark',
] as const

export type SyntaxAppearanceVariant = (typeof SYNTAX_APPEARANCE_VARIANTS)[number]

/**
 * Stable resource identity. Bundled resources use `bundled:<shiki-id>` while imported
 * resources use a scope-qualified package identity plus a variant suffix.
 */
export type SyntaxThemeId = string

export interface SyntaxThemeSelections {
  readonly light: SyntaxThemeId
  readonly dark: SyntaxThemeId
  readonly 'high-contrast-light': SyntaxThemeId
  readonly 'high-contrast-dark': SyntaxThemeId
}

export interface BundledSyntaxTheme {
  readonly id: SyntaxThemeId
  readonly shikiTheme: string
  readonly label: string
  readonly variant: SyntaxAppearanceVariant
  readonly description: string
  readonly preview: SyntaxThemePreviewPalette
}

export interface SyntaxThemePreviewPalette {
  readonly background: string
  readonly foreground: string
  readonly accents: readonly [string, string, string, string]
}

export const BUNDLED_SYNTAX_THEMES = [
  {
    id: 'bundled:light-plus',
    shikiTheme: 'light-plus',
    label: 'Light+',
    variant: 'light',
    description: 'The familiar VS Code light syntax palette.',
    preview: {
      background: '#ffffff',
      foreground: '#000000',
      accents: ['#0000ff', '#267f99', '#a31515', '#008000'],
    },
  },
  {
    id: 'bundled:github-light',
    shikiTheme: 'github-light',
    label: 'GitHub Light',
    variant: 'light',
    description: 'Clean, restrained colours tuned for reading.',
    preview: {
      background: '#ffffff',
      foreground: '#24292f',
      accents: ['#cf222e', '#0550ae', '#8250df', '#116329'],
    },
  },
  {
    id: 'bundled:catppuccin-latte',
    shikiTheme: 'catppuccin-latte',
    label: 'Catppuccin Latte',
    variant: 'light',
    description: 'Warm light surfaces with clear token separation.',
    preview: {
      background: '#eff1f5',
      foreground: '#4c4f69',
      accents: ['#8839ef', '#1e66f5', '#40a02b', '#d20f39'],
    },
  },
  {
    id: 'bundled:rose-pine-dawn',
    shikiTheme: 'rose-pine-dawn',
    label: 'Rosé Pine Dawn',
    variant: 'light',
    description: 'A softer light palette for long sessions.',
    preview: {
      background: '#faf4ed',
      foreground: '#575279',
      accents: ['#907aa9', '#286983', '#d7827e', '#56949f'],
    },
  },
  {
    id: 'bundled:dark-plus',
    shikiTheme: 'dark-plus',
    label: 'Dark+',
    variant: 'dark',
    description: 'The familiar VS Code dark syntax palette.',
    preview: {
      background: '#1e1e1e',
      foreground: '#d4d4d4',
      accents: ['#569cd6', '#4ec9b0', '#ce9178', '#6a9955'],
    },
  },
  {
    id: 'bundled:github-dark',
    shikiTheme: 'github-dark',
    label: 'GitHub Dark',
    variant: 'dark',
    description: 'Balanced contrast for everyday source reading.',
    preview: {
      background: '#0d1117',
      foreground: '#c9d1d9',
      accents: ['#ff7b72', '#79c0ff', '#d2a8ff', '#7ee787'],
    },
  },
  {
    id: 'bundled:one-dark-pro',
    shikiTheme: 'one-dark-pro',
    label: 'One Dark Pro',
    variant: 'dark',
    description: 'A saturated editor palette with strong token distinction.',
    preview: {
      background: '#282c34',
      foreground: '#abb2bf',
      accents: ['#c678dd', '#61afef', '#98c379', '#e06c75'],
    },
  },
  {
    id: 'bundled:nord',
    shikiTheme: 'nord',
    label: 'Nord',
    variant: 'dark',
    description: 'Cool, low-fatigue colours for longer reading sessions.',
    preview: {
      background: '#2e3440',
      foreground: '#d8dee9',
      accents: ['#81a1c1', '#88c0d0', '#a3be8c', '#b48ead'],
    },
  },
  {
    id: 'bundled:github-light-high-contrast',
    shikiTheme: 'github-light-high-contrast',
    label: 'GitHub Light High Contrast',
    variant: 'high-contrast-light',
    description: 'High-contrast light syntax with strong boundaries.',
    preview: {
      background: '#ffffff',
      foreground: '#0e1116',
      accents: ['#a0111f', '#0349b4', '#622cbc', '#024c1a'],
    },
  },
  {
    id: 'bundled:github-dark-high-contrast',
    shikiTheme: 'github-dark-high-contrast',
    label: 'GitHub Dark High Contrast',
    variant: 'high-contrast-dark',
    description: 'High-contrast dark syntax with strong boundaries.',
    preview: {
      background: '#0a0c10',
      foreground: '#f0f3f6',
      accents: ['#ff9492', '#91cbff', '#dbb7ff', '#8ddb8c'],
    },
  },
] as const satisfies readonly BundledSyntaxTheme[]

export const DEFAULT_SYNTAX_THEME_SELECTIONS: SyntaxThemeSelections = {
  light: 'bundled:light-plus',
  dark: 'bundled:dark-plus',
  'high-contrast-light': 'bundled:github-light-high-contrast',
  'high-contrast-dark': 'bundled:github-dark-high-contrast',
}

export function bundledSyntaxTheme(themeId: SyntaxThemeId) {
  return BUNDLED_SYNTAX_THEMES.find((theme) => theme.id === themeId)
}

export function bundledShikiTheme(themeId: SyntaxThemeId) {
  return bundledSyntaxTheme(themeId)?.shikiTheme ?? 'dark-plus'
}

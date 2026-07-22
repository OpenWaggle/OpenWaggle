import type {
  OpenWaggleExtensionThemeCssVariables,
  OpenWaggleExtensionThemeTokens,
} from './theme-types.js'

export const OPENWAGGLE_EXTENSION_THEME_CSS_VARIABLES = {
  color: {
    background: '--ow-color-background',
    surface: '--ow-color-surface',
    surfaceRaised: '--ow-color-surface-raised',
    surfaceHover: '--ow-color-surface-hover',
    surfaceActive: '--ow-color-surface-active',
    border: '--ow-color-border',
    borderStrong: '--ow-color-border-strong',
    text: '--ow-color-text',
    textSubtle: '--ow-color-text-subtle',
    textMuted: '--ow-color-text-muted',
    textDim: '--ow-color-text-dim',
    accent: '--ow-color-accent',
    accentDim: '--ow-color-accent-dim',
    success: '--ow-color-success',
    danger: '--ow-color-danger',
    warning: '--ow-color-warning',
    info: '--ow-color-info',
  },
  typography: {
    sansFamily: '--ow-font-family-sans',
    monoFamily: '--ow-font-family-mono',
  },
  spacing: {
    xs: '--ow-space-xs',
    sm: '--ow-space-sm',
    md: '--ow-space-md',
    lg: '--ow-space-lg',
    xl: '--ow-space-xl',
  },
  radius: {
    sm: '--ow-radius-sm',
    md: '--ow-radius-md',
    lg: '--ow-radius-lg',
    panel: '--ow-radius-panel',
  },
  focus: {
    ring: '--ow-focus-ring',
    shadow: '--ow-focus-shadow',
  },
  elevation: {
    card: '--ow-elevation-card',
    overlay: '--ow-elevation-overlay',
  },
} as const satisfies OpenWaggleExtensionThemeCssVariables

export const DEFAULT_EXTENSION_THEME_TOKENS = {
  color: {
    background: '#141619',
    surface: '#1a1d22',
    surfaceRaised: '#1f232a',
    surfaceHover: '#262b33',
    surfaceActive: '#1d1a10',
    border: '#1e2229',
    borderStrong: '#2a3240',
    text: '#e7e9ee',
    textSubtle: '#c9cdd6',
    textMuted: '#9098a8',
    textDim: '#666f7d',
    accent: '#f5a623',
    accentDim: '#b87410',
    success: '#4caf72',
    danger: '#ef4444',
    warning: '#f5a623',
    info: '#61a8ff',
  },
  typography: {
    sansFamily:
      'Inter, "SF Pro Text", "SF Pro Display", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    monoFamily: '"SF Mono", "JetBrains Mono", "Cascadia Mono", ui-monospace, monospace',
  },
  spacing: {
    xs: '4px',
    sm: '8px',
    md: '12px',
    lg: '16px',
    xl: '24px',
  },
  radius: {
    sm: '6px',
    md: '9px',
    lg: '12px',
    panel: '22px',
  },
  focus: {
    ring: '#9aa3b2',
    shadow:
      '0 0 0 1px color-mix(in srgb, #9aa3b2 76%, transparent), 0 0 0 3px color-mix(in srgb, #9aa3b2 15%, transparent)',
  },
  elevation: {
    card: 'inset 0 1px 0 rgba(255, 255, 255, 0.02)',
    overlay: '0 24px 80px rgba(0, 0, 0, 0.45)',
  },
} as const satisfies OpenWaggleExtensionThemeTokens

export const SOURCE_EXTENSION_THEME_CSS_VARIABLES = {
  color: {
    background: '--color-bg',
    surface: '--color-bg-secondary',
    surfaceRaised: '--color-bg-tertiary',
    surfaceHover: '--color-bg-hover',
    surfaceActive: '--color-bg-active',
    border: '--color-border',
    borderStrong: '--color-border-light',
    text: '--color-text-primary',
    textSubtle: '--color-text-secondary',
    textMuted: '--color-text-tertiary',
    textDim: '--color-text-muted',
    accent: '--color-accent',
    accentDim: '--color-accent-dim',
    success: '--color-success',
    danger: '--color-error',
    warning: '--color-warning',
    info: '--color-info',
  },
  typography: {
    sansFamily: '--font-sans',
    monoFamily: '--font-mono',
  },
  radius: {
    panel: '--radius-panel',
  },
} as const

export const EXTENSION_THEME_COLOR_KEYS = [
  'background',
  'surface',
  'surfaceRaised',
  'surfaceHover',
  'surfaceActive',
  'border',
  'borderStrong',
  'text',
  'textSubtle',
  'textMuted',
  'textDim',
  'accent',
  'accentDim',
  'success',
  'danger',
  'warning',
  'info',
] as const
export const EXTENSION_THEME_TYPOGRAPHY_KEYS = ['sansFamily', 'monoFamily'] as const
export const EXTENSION_THEME_SPACING_KEYS = ['xs', 'sm', 'md', 'lg', 'xl'] as const
export const EXTENSION_THEME_RADIUS_KEYS = ['sm', 'md', 'lg', 'panel'] as const
export const EXTENSION_THEME_FOCUS_KEYS = ['ring', 'shadow'] as const
export const EXTENSION_THEME_ELEVATION_KEYS = ['card', 'overlay'] as const

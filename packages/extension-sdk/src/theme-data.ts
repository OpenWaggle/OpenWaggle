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
    dangerText: '--ow-color-danger-text',
    warning: '--ow-color-warning',
    info: '--ow-color-info',
    infoText: '--ow-color-info-text',
    review: '--ow-color-review',
    plan: '--ow-color-plan',
    progress: '--ow-color-progress',
    neutral: '--ow-color-neutral',
  },
  typography: {
    sansFamily: '--ow-font-family-sans',
    monoFamily: '--ow-font-family-mono',
    typeScale: {
      xs: {
        fontSize: '--ow-text-xs',
        lineHeight: '--ow-text-xs--line-height',
      },
      sm: {
        fontSize: '--ow-text-sm',
        lineHeight: '--ow-text-sm--line-height',
      },
      base: {
        fontSize: '--ow-text-base',
        lineHeight: '--ow-text-base--line-height',
      },
      lg: {
        fontSize: '--ow-text-lg',
        lineHeight: '--ow-text-lg--line-height',
      },
      xl: {
        fontSize: '--ow-text-xl',
        lineHeight: '--ow-text-xl--line-height',
      },
      twoXl: {
        fontSize: '--ow-text-2xl',
        lineHeight: '--ow-text-2xl--line-height',
      },
    },
  },
  spacing: {
    unit: '--ow-spacing',
  },
  radius: {
    xs: '--ow-radius-xs',
    sm: '--ow-radius-sm',
    md: '--ow-radius-md',
    lg: '--ow-radius-lg',
    xl: '--ow-radius-xl',
    twoXl: '--ow-radius-2xl',
    threeXl: '--ow-radius-3xl',
    fourXl: '--ow-radius-4xl',
  },
  shadow: {
    twoXs: '--ow-shadow-2xs',
    xs: '--ow-shadow-xs',
    sm: '--ow-shadow-sm',
    md: '--ow-shadow-md',
    lg: '--ow-shadow-lg',
    xl: '--ow-shadow-xl',
    twoXl: '--ow-shadow-2xl',
  },
  focus: {
    ring: '--ow-focus-ring',
    shadow: '--ow-focus-shadow',
  },
} as const satisfies OpenWaggleExtensionThemeCssVariables

export const DEFAULT_EXTENSION_THEME_TOKENS = {
  color: {
    background: '#141719',
    surface: '#1a1d22',
    surfaceRaised: '#20242b',
    surfaceHover: '#262b33',
    surfaceActive: '#2b313a',
    border: '#1e2229',
    borderStrong: '#2a3240',
    text: '#e7e9ee',
    textSubtle: '#c9cdd6',
    textMuted: '#9098a8',
    textDim: '#8f98a8',
    accent: '#f5a623',
    accentDim: '#d18a2c',
    success: '#4caf72',
    danger: '#ef4444',
    dangerText: '#f87171',
    warning: '#f97316',
    info: '#3b82f6',
    infoText: '#60a5fa',
    review: '#a78bfa',
    plan: '#e879f9',
    progress: '#7dd3fc',
    neutral: '#9098a8',
  },
  typography: {
    sansFamily:
      '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", "Noto Sans", Arial, sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol", "Noto Color Emoji"',
    monoFamily:
      'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
    typeScale: {
      xs: { fontSize: '0.75rem', lineHeight: 'calc(1 / 0.75)' },
      sm: { fontSize: '0.875rem', lineHeight: 'calc(1.25 / 0.875)' },
      base: { fontSize: '1rem', lineHeight: 'calc(1.5 / 1)' },
      lg: { fontSize: '1.125rem', lineHeight: 'calc(1.75 / 1.125)' },
      xl: { fontSize: '1.25rem', lineHeight: 'calc(1.75 / 1.25)' },
      twoXl: { fontSize: '1.5rem', lineHeight: 'calc(2 / 1.5)' },
    },
  },
  spacing: {
    unit: '0.25rem',
  },
  radius: {
    xs: '0.125rem',
    sm: '0.25rem',
    md: '0.375rem',
    lg: '0.5rem',
    xl: '0.75rem',
    twoXl: '1rem',
    threeXl: '1.5rem',
    fourXl: '2rem',
  },
  shadow: {
    twoXs: '0 1px rgb(0 0 0 / 0.05)',
    xs: '0 1px 2px 0 rgb(0 0 0 / 0.05)',
    sm: '0 1px 3px 0 rgb(0 0 0 / 0.1), 0 1px 2px -1px rgb(0 0 0 / 0.1)',
    md: '0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)',
    lg: '0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1)',
    xl: '0 20px 25px -5px rgb(0 0 0 / 0.1), 0 8px 10px -6px rgb(0 0 0 / 0.1)',
    twoXl: '0 25px 50px -12px rgb(0 0 0 / 0.25)',
  },
  focus: {
    ring: 'transparent',
    shadow: 'none',
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
    dangerText: '--color-error-text',
    warning: '--color-warning',
    info: '--color-info',
    infoText: '--color-info-text',
    review: '--color-review',
    plan: '--color-plan',
    progress: '--color-progress',
    neutral: '--color-neutral',
  },
  typography: {
    sansFamily: '--font-sans',
    monoFamily: '--font-mono',
    typeScale: {
      xs: {
        fontSize: '--text-xs',
        lineHeight: '--text-xs--line-height',
      },
      sm: {
        fontSize: '--text-sm',
        lineHeight: '--text-sm--line-height',
      },
      base: {
        fontSize: '--text-base',
        lineHeight: '--text-base--line-height',
      },
      lg: {
        fontSize: '--text-lg',
        lineHeight: '--text-lg--line-height',
      },
      xl: {
        fontSize: '--text-xl',
        lineHeight: '--text-xl--line-height',
      },
      twoXl: {
        fontSize: '--text-2xl',
        lineHeight: '--text-2xl--line-height',
      },
    },
  },
  spacing: {
    unit: '--spacing',
  },
  radius: {
    xs: '--radius-xs',
    sm: '--radius-sm',
    md: '--radius-md',
    lg: '--radius-lg',
    xl: '--radius-xl',
    twoXl: '--radius-2xl',
    threeXl: '--radius-3xl',
    fourXl: '--radius-4xl',
  },
  shadow: {
    twoXs: '--shadow-2xs',
    xs: '--shadow-xs',
    sm: '--shadow-sm',
    md: '--shadow-md',
    lg: '--shadow-lg',
    xl: '--shadow-xl',
    twoXl: '--shadow-2xl',
  },
  focus: {
    ring: '--focus-ring',
    shadow: '--focus-shadow',
  },
} as const satisfies OpenWaggleExtensionThemeCssVariables

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
  'dangerText',
  'warning',
  'info',
  'infoText',
  'review',
  'plan',
  'progress',
  'neutral',
] as const
export const EXTENSION_THEME_TYPOGRAPHY_KEYS = ['sansFamily', 'monoFamily'] as const
export const EXTENSION_THEME_TYPE_SCALE_KEYS = ['xs', 'sm', 'base', 'lg', 'xl', 'twoXl'] as const
export const EXTENSION_THEME_TYPE_SCALE_ENTRY_KEYS = ['fontSize', 'lineHeight'] as const
export const EXTENSION_THEME_SPACING_KEYS = ['unit'] as const
export const EXTENSION_THEME_RADIUS_KEYS = [
  'xs',
  'sm',
  'md',
  'lg',
  'xl',
  'twoXl',
  'threeXl',
  'fourXl',
] as const
export const EXTENSION_THEME_SHADOW_KEYS = ['twoXs', 'xs', 'sm', 'md', 'lg', 'xl', 'twoXl'] as const
export const EXTENSION_THEME_FOCUS_KEYS = ['ring', 'shadow'] as const

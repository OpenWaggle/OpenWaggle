import { isRecord } from './internal-validation.js'
import {
  DEFAULT_EXTENSION_THEME_TOKENS,
  EXTENSION_THEME_COLOR_KEYS,
  EXTENSION_THEME_ELEVATION_KEYS,
  EXTENSION_THEME_FOCUS_KEYS,
  EXTENSION_THEME_RADIUS_KEYS,
  EXTENSION_THEME_SPACING_KEYS,
  EXTENSION_THEME_TYPOGRAPHY_KEYS,
  OPENWAGGLE_EXTENSION_THEME_CSS_VARIABLES,
  SOURCE_EXTENSION_THEME_CSS_VARIABLES,
} from './theme-data.js'
import type {
  CreateOpenWaggleExtensionThemeOptions,
  ExtensionThemeCssVariableResolver,
  OpenWaggleExtensionTheme,
  OpenWaggleExtensionThemeCssVariableEntry,
  OpenWaggleExtensionThemeTokens,
} from './theme-types.js'

export { OPENWAGGLE_EXTENSION_THEME_CSS_VARIABLES } from './theme-data.js'
export type {
  CreateOpenWaggleExtensionThemeOptions,
  ExtensionThemeCssVariableResolver,
  OpenWaggleExtensionColorScheme,
  OpenWaggleExtensionTheme,
  OpenWaggleExtensionThemeCssVariableEntry,
  OpenWaggleExtensionThemeCssVariables,
  OpenWaggleExtensionThemeTokens,
} from './theme-types.js'

const EMPTY_LENGTH = 0

function resolvedCssValue(
  resolver: ExtensionThemeCssVariableResolver | undefined,
  cssVariable: string | undefined,
  fallback: string,
) {
  if (resolver === undefined || cssVariable === undefined) {
    return fallback
  }

  const resolved = resolver(cssVariable, fallback).trim()
  return resolved.length > EMPTY_LENGTH ? resolved : fallback
}

function colorTokens(
  resolve: ExtensionThemeCssVariableResolver | undefined,
): OpenWaggleExtensionThemeTokens['color'] {
  const source = SOURCE_EXTENSION_THEME_CSS_VARIABLES.color
  const fallback = DEFAULT_EXTENSION_THEME_TOKENS.color

  return {
    background: resolvedCssValue(resolve, source.background, fallback.background),
    surface: resolvedCssValue(resolve, source.surface, fallback.surface),
    surfaceRaised: resolvedCssValue(resolve, source.surfaceRaised, fallback.surfaceRaised),
    surfaceHover: resolvedCssValue(resolve, source.surfaceHover, fallback.surfaceHover),
    surfaceActive: resolvedCssValue(resolve, source.surfaceActive, fallback.surfaceActive),
    border: resolvedCssValue(resolve, source.border, fallback.border),
    borderStrong: resolvedCssValue(resolve, source.borderStrong, fallback.borderStrong),
    text: resolvedCssValue(resolve, source.text, fallback.text),
    textSubtle: resolvedCssValue(resolve, source.textSubtle, fallback.textSubtle),
    textMuted: resolvedCssValue(resolve, source.textMuted, fallback.textMuted),
    textDim: resolvedCssValue(resolve, source.textDim, fallback.textDim),
    accent: resolvedCssValue(resolve, source.accent, fallback.accent),
    accentDim: resolvedCssValue(resolve, source.accentDim, fallback.accentDim),
    success: resolvedCssValue(resolve, source.success, fallback.success),
    danger: resolvedCssValue(resolve, source.danger, fallback.danger),
    warning: resolvedCssValue(resolve, source.warning, fallback.warning),
    info: resolvedCssValue(resolve, source.info, fallback.info),
  }
}

function typographyTokens(
  resolve: ExtensionThemeCssVariableResolver | undefined,
): OpenWaggleExtensionThemeTokens['typography'] {
  const source = SOURCE_EXTENSION_THEME_CSS_VARIABLES.typography
  const fallback = DEFAULT_EXTENSION_THEME_TOKENS.typography

  return {
    sansFamily: resolvedCssValue(resolve, source.sansFamily, fallback.sansFamily),
    monoFamily: resolvedCssValue(resolve, source.monoFamily, fallback.monoFamily),
  }
}

function radiusTokens(
  resolve: ExtensionThemeCssVariableResolver | undefined,
): OpenWaggleExtensionThemeTokens['radius'] {
  const fallback = DEFAULT_EXTENSION_THEME_TOKENS.radius

  return {
    sm: fallback.sm,
    md: fallback.md,
    lg: fallback.lg,
    panel: resolvedCssValue(
      resolve,
      SOURCE_EXTENSION_THEME_CSS_VARIABLES.radius.panel,
      fallback.panel,
    ),
  }
}

function hasStringKeys(value: unknown, keys: readonly string[]) {
  if (!isRecord(value)) {
    return false
  }

  for (const key of keys) {
    if (typeof value[key] !== 'string') {
      return false
    }
  }

  return true
}

function hasThemeTokenGroups(value: unknown) {
  return (
    isRecord(value) &&
    hasStringKeys(value.color, EXTENSION_THEME_COLOR_KEYS) &&
    hasStringKeys(value.typography, EXTENSION_THEME_TYPOGRAPHY_KEYS) &&
    hasStringKeys(value.spacing, EXTENSION_THEME_SPACING_KEYS) &&
    hasStringKeys(value.radius, EXTENSION_THEME_RADIUS_KEYS) &&
    hasStringKeys(value.focus, EXTENSION_THEME_FOCUS_KEYS) &&
    hasStringKeys(value.elevation, EXTENSION_THEME_ELEVATION_KEYS)
  )
}

export function createOpenWaggleExtensionTheme(
  options: CreateOpenWaggleExtensionThemeOptions = {},
): OpenWaggleExtensionTheme {
  const resolve = options.resolveCssVariable

  return {
    colorScheme: 'dark',
    tokens: {
      color: colorTokens(resolve),
      typography: typographyTokens(resolve),
      spacing: DEFAULT_EXTENSION_THEME_TOKENS.spacing,
      radius: radiusTokens(resolve),
      focus: DEFAULT_EXTENSION_THEME_TOKENS.focus,
      elevation: DEFAULT_EXTENSION_THEME_TOKENS.elevation,
    },
    cssVariables: OPENWAGGLE_EXTENSION_THEME_CSS_VARIABLES,
  }
}

export function extensionThemeCssVariableEntries(
  theme: OpenWaggleExtensionTheme,
): readonly OpenWaggleExtensionThemeCssVariableEntry[] {
  return [
    { name: theme.cssVariables.color.background, value: theme.tokens.color.background },
    { name: theme.cssVariables.color.surface, value: theme.tokens.color.surface },
    { name: theme.cssVariables.color.surfaceRaised, value: theme.tokens.color.surfaceRaised },
    { name: theme.cssVariables.color.surfaceHover, value: theme.tokens.color.surfaceHover },
    { name: theme.cssVariables.color.surfaceActive, value: theme.tokens.color.surfaceActive },
    { name: theme.cssVariables.color.border, value: theme.tokens.color.border },
    { name: theme.cssVariables.color.borderStrong, value: theme.tokens.color.borderStrong },
    { name: theme.cssVariables.color.text, value: theme.tokens.color.text },
    { name: theme.cssVariables.color.textSubtle, value: theme.tokens.color.textSubtle },
    { name: theme.cssVariables.color.textMuted, value: theme.tokens.color.textMuted },
    { name: theme.cssVariables.color.textDim, value: theme.tokens.color.textDim },
    { name: theme.cssVariables.color.accent, value: theme.tokens.color.accent },
    { name: theme.cssVariables.color.accentDim, value: theme.tokens.color.accentDim },
    { name: theme.cssVariables.color.success, value: theme.tokens.color.success },
    { name: theme.cssVariables.color.danger, value: theme.tokens.color.danger },
    { name: theme.cssVariables.color.warning, value: theme.tokens.color.warning },
    { name: theme.cssVariables.color.info, value: theme.tokens.color.info },
    { name: theme.cssVariables.typography.sansFamily, value: theme.tokens.typography.sansFamily },
    { name: theme.cssVariables.typography.monoFamily, value: theme.tokens.typography.monoFamily },
    { name: theme.cssVariables.spacing.xs, value: theme.tokens.spacing.xs },
    { name: theme.cssVariables.spacing.sm, value: theme.tokens.spacing.sm },
    { name: theme.cssVariables.spacing.md, value: theme.tokens.spacing.md },
    { name: theme.cssVariables.spacing.lg, value: theme.tokens.spacing.lg },
    { name: theme.cssVariables.spacing.xl, value: theme.tokens.spacing.xl },
    { name: theme.cssVariables.radius.sm, value: theme.tokens.radius.sm },
    { name: theme.cssVariables.radius.md, value: theme.tokens.radius.md },
    { name: theme.cssVariables.radius.lg, value: theme.tokens.radius.lg },
    { name: theme.cssVariables.radius.panel, value: theme.tokens.radius.panel },
    { name: theme.cssVariables.focus.ring, value: theme.tokens.focus.ring },
    { name: theme.cssVariables.focus.shadow, value: theme.tokens.focus.shadow },
    { name: theme.cssVariables.elevation.card, value: theme.tokens.elevation.card },
    { name: theme.cssVariables.elevation.overlay, value: theme.tokens.elevation.overlay },
  ]
}

export function isOpenWaggleExtensionTheme(value: unknown): value is OpenWaggleExtensionTheme {
  return (
    isRecord(value) &&
    value.colorScheme === 'dark' &&
    hasThemeTokenGroups(value.tokens) &&
    hasThemeTokenGroups(value.cssVariables)
  )
}

import {
  DEFAULT_EXTENSION_THEME_TOKENS,
  EXTENSION_THEME_TYPE_SCALE_KEYS,
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
  OpenWaggleExtensionTypeScaleEntry,
} from './theme-types.js'
export { isOpenWaggleExtensionTheme } from './theme-validation.js'

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
    dangerText: resolvedCssValue(resolve, source.dangerText, fallback.dangerText),
    warning: resolvedCssValue(resolve, source.warning, fallback.warning),
    info: resolvedCssValue(resolve, source.info, fallback.info),
    infoText: resolvedCssValue(resolve, source.infoText, fallback.infoText),
    review: resolvedCssValue(resolve, source.review, fallback.review),
    plan: resolvedCssValue(resolve, source.plan, fallback.plan),
    progress: resolvedCssValue(resolve, source.progress, fallback.progress),
    neutral: resolvedCssValue(resolve, source.neutral, fallback.neutral),
  }
}

function typeScaleEntryTokens(
  resolve: ExtensionThemeCssVariableResolver | undefined,
  role: (typeof EXTENSION_THEME_TYPE_SCALE_KEYS)[number],
) {
  const source = SOURCE_EXTENSION_THEME_CSS_VARIABLES.typography.typeScale[role]
  const fallback = DEFAULT_EXTENSION_THEME_TOKENS.typography.typeScale[role]

  return {
    fontSize: resolvedCssValue(resolve, source.fontSize, fallback.fontSize),
    lineHeight: resolvedCssValue(resolve, source.lineHeight, fallback.lineHeight),
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
    typeScale: {
      xs: typeScaleEntryTokens(resolve, 'xs'),
      sm: typeScaleEntryTokens(resolve, 'sm'),
      base: typeScaleEntryTokens(resolve, 'base'),
      lg: typeScaleEntryTokens(resolve, 'lg'),
      xl: typeScaleEntryTokens(resolve, 'xl'),
      twoXl: typeScaleEntryTokens(resolve, 'twoXl'),
    },
  }
}

function spacingTokens(
  resolve: ExtensionThemeCssVariableResolver | undefined,
): OpenWaggleExtensionThemeTokens['spacing'] {
  const source = SOURCE_EXTENSION_THEME_CSS_VARIABLES.spacing
  const fallback = DEFAULT_EXTENSION_THEME_TOKENS.spacing

  return {
    unit: resolvedCssValue(resolve, source.unit, fallback.unit),
  }
}

function radiusTokens(
  resolve: ExtensionThemeCssVariableResolver | undefined,
): OpenWaggleExtensionThemeTokens['radius'] {
  const source = SOURCE_EXTENSION_THEME_CSS_VARIABLES.radius
  const fallback = DEFAULT_EXTENSION_THEME_TOKENS.radius

  return {
    xs: resolvedCssValue(resolve, source.xs, fallback.xs),
    sm: resolvedCssValue(resolve, source.sm, fallback.sm),
    md: resolvedCssValue(resolve, source.md, fallback.md),
    lg: resolvedCssValue(resolve, source.lg, fallback.lg),
    xl: resolvedCssValue(resolve, source.xl, fallback.xl),
    twoXl: resolvedCssValue(resolve, source.twoXl, fallback.twoXl),
    threeXl: resolvedCssValue(resolve, source.threeXl, fallback.threeXl),
    fourXl: resolvedCssValue(resolve, source.fourXl, fallback.fourXl),
  }
}

function shadowTokens(
  resolve: ExtensionThemeCssVariableResolver | undefined,
): OpenWaggleExtensionThemeTokens['shadow'] {
  const source = SOURCE_EXTENSION_THEME_CSS_VARIABLES.shadow
  const fallback = DEFAULT_EXTENSION_THEME_TOKENS.shadow

  return {
    twoXs: resolvedCssValue(resolve, source.twoXs, fallback.twoXs),
    xs: resolvedCssValue(resolve, source.xs, fallback.xs),
    sm: resolvedCssValue(resolve, source.sm, fallback.sm),
    md: resolvedCssValue(resolve, source.md, fallback.md),
    lg: resolvedCssValue(resolve, source.lg, fallback.lg),
    xl: resolvedCssValue(resolve, source.xl, fallback.xl),
    twoXl: resolvedCssValue(resolve, source.twoXl, fallback.twoXl),
  }
}

function focusTokens(
  resolve: ExtensionThemeCssVariableResolver | undefined,
): OpenWaggleExtensionThemeTokens['focus'] {
  const source = SOURCE_EXTENSION_THEME_CSS_VARIABLES.focus
  const fallback = DEFAULT_EXTENSION_THEME_TOKENS.focus

  return {
    ring: resolvedCssValue(resolve, source.ring, fallback.ring),
    shadow: resolvedCssValue(resolve, source.shadow, fallback.shadow),
  }
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
      spacing: spacingTokens(resolve),
      radius: radiusTokens(resolve),
      shadow: shadowTokens(resolve),
      focus: focusTokens(resolve),
    },
    cssVariables: OPENWAGGLE_EXTENSION_THEME_CSS_VARIABLES,
  }
}

export function extensionThemeCssVariableEntries(
  theme: OpenWaggleExtensionTheme,
): readonly OpenWaggleExtensionThemeCssVariableEntry[] {
  const typeScaleEntries = EXTENSION_THEME_TYPE_SCALE_KEYS.flatMap((role) => [
    {
      name: theme.cssVariables.typography.typeScale[role].fontSize,
      value: theme.tokens.typography.typeScale[role].fontSize,
    },
    {
      name: theme.cssVariables.typography.typeScale[role].lineHeight,
      value: theme.tokens.typography.typeScale[role].lineHeight,
    },
  ])

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
    { name: theme.cssVariables.color.dangerText, value: theme.tokens.color.dangerText },
    { name: theme.cssVariables.color.warning, value: theme.tokens.color.warning },
    { name: theme.cssVariables.color.info, value: theme.tokens.color.info },
    { name: theme.cssVariables.color.infoText, value: theme.tokens.color.infoText },
    { name: theme.cssVariables.color.review, value: theme.tokens.color.review },
    { name: theme.cssVariables.color.plan, value: theme.tokens.color.plan },
    { name: theme.cssVariables.color.progress, value: theme.tokens.color.progress },
    { name: theme.cssVariables.color.neutral, value: theme.tokens.color.neutral },
    { name: theme.cssVariables.typography.sansFamily, value: theme.tokens.typography.sansFamily },
    { name: theme.cssVariables.typography.monoFamily, value: theme.tokens.typography.monoFamily },
    ...typeScaleEntries,
    { name: theme.cssVariables.spacing.unit, value: theme.tokens.spacing.unit },
    { name: theme.cssVariables.radius.xs, value: theme.tokens.radius.xs },
    { name: theme.cssVariables.radius.sm, value: theme.tokens.radius.sm },
    { name: theme.cssVariables.radius.md, value: theme.tokens.radius.md },
    { name: theme.cssVariables.radius.lg, value: theme.tokens.radius.lg },
    { name: theme.cssVariables.radius.xl, value: theme.tokens.radius.xl },
    { name: theme.cssVariables.radius.twoXl, value: theme.tokens.radius.twoXl },
    { name: theme.cssVariables.radius.threeXl, value: theme.tokens.radius.threeXl },
    { name: theme.cssVariables.radius.fourXl, value: theme.tokens.radius.fourXl },
    { name: theme.cssVariables.shadow.twoXs, value: theme.tokens.shadow.twoXs },
    { name: theme.cssVariables.shadow.xs, value: theme.tokens.shadow.xs },
    { name: theme.cssVariables.shadow.sm, value: theme.tokens.shadow.sm },
    { name: theme.cssVariables.shadow.md, value: theme.tokens.shadow.md },
    { name: theme.cssVariables.shadow.lg, value: theme.tokens.shadow.lg },
    { name: theme.cssVariables.shadow.xl, value: theme.tokens.shadow.xl },
    { name: theme.cssVariables.shadow.twoXl, value: theme.tokens.shadow.twoXl },
    { name: theme.cssVariables.focus.ring, value: theme.tokens.focus.ring },
    { name: theme.cssVariables.focus.shadow, value: theme.tokens.focus.shadow },
  ]
}

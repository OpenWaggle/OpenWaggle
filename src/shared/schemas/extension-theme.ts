import type {
  OpenWaggleExtensionTheme,
  OpenWaggleExtensionThemeCssVariables,
  OpenWaggleExtensionThemeTokens,
} from '@shared/extension-theme'
import { Schema } from '@shared/schema'

const colorThemeGroupSchema: Schema.Schema<OpenWaggleExtensionThemeTokens['color']> = Schema.Struct(
  {
    background: Schema.String,
    surface: Schema.String,
    surfaceRaised: Schema.String,
    surfaceHover: Schema.String,
    surfaceActive: Schema.String,
    border: Schema.String,
    borderStrong: Schema.String,
    text: Schema.String,
    textSubtle: Schema.String,
    textMuted: Schema.String,
    textDim: Schema.String,
    accent: Schema.String,
    accentDim: Schema.String,
    success: Schema.String,
    danger: Schema.String,
    dangerText: Schema.String,
    warning: Schema.String,
    info: Schema.String,
    infoText: Schema.String,
    review: Schema.String,
    plan: Schema.String,
    progress: Schema.String,
    neutral: Schema.String,
  },
)

const typeScaleEntrySchema: Schema.Schema<
  OpenWaggleExtensionThemeTokens['typography']['typeScale']['xs']
> = Schema.Struct({
  fontSize: Schema.String,
  lineHeight: Schema.String,
})

const typographyThemeGroupSchema: Schema.Schema<OpenWaggleExtensionThemeTokens['typography']> =
  Schema.Struct({
    sansFamily: Schema.String,
    monoFamily: Schema.String,
    typeScale: Schema.Struct({
      xs: typeScaleEntrySchema,
      sm: typeScaleEntrySchema,
      base: typeScaleEntrySchema,
      lg: typeScaleEntrySchema,
      xl: typeScaleEntrySchema,
      twoXl: typeScaleEntrySchema,
    }),
  })

const spacingThemeGroupSchema: Schema.Schema<OpenWaggleExtensionThemeTokens['spacing']> =
  Schema.Struct({
    unit: Schema.String,
  })

const radiusThemeGroupSchema: Schema.Schema<OpenWaggleExtensionThemeTokens['radius']> =
  Schema.Struct({
    xs: Schema.String,
    sm: Schema.String,
    md: Schema.String,
    lg: Schema.String,
    xl: Schema.String,
    twoXl: Schema.String,
    threeXl: Schema.String,
    fourXl: Schema.String,
  })

const shadowThemeGroupSchema: Schema.Schema<OpenWaggleExtensionThemeTokens['shadow']> =
  Schema.Struct({
    twoXs: Schema.String,
    xs: Schema.String,
    sm: Schema.String,
    md: Schema.String,
    lg: Schema.String,
    xl: Schema.String,
    twoXl: Schema.String,
  })

const focusThemeGroupSchema: Schema.Schema<OpenWaggleExtensionThemeTokens['focus']> = Schema.Struct(
  {
    ring: Schema.String,
    shadow: Schema.String,
  },
)

export const extensionThemeTokensSchema: Schema.Schema<OpenWaggleExtensionThemeTokens> =
  Schema.Struct({
    color: colorThemeGroupSchema,
    typography: typographyThemeGroupSchema,
    spacing: spacingThemeGroupSchema,
    radius: radiusThemeGroupSchema,
    shadow: shadowThemeGroupSchema,
    focus: focusThemeGroupSchema,
  })

export const extensionThemeCssVariablesSchema: Schema.Schema<OpenWaggleExtensionThemeCssVariables> =
  extensionThemeTokensSchema

export const extensionThemeSchema: Schema.Schema<OpenWaggleExtensionTheme> = Schema.Struct({
  colorScheme: Schema.Literal('dark', 'light', 'high-contrast-dark', 'high-contrast-light'),
  tokens: extensionThemeTokensSchema,
  cssVariables: extensionThemeCssVariablesSchema,
})

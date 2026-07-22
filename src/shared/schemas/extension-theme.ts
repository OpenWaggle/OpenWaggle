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
    warning: Schema.String,
    info: Schema.String,
  },
)

const typographyThemeGroupSchema: Schema.Schema<OpenWaggleExtensionThemeTokens['typography']> =
  Schema.Struct({
    sansFamily: Schema.String,
    monoFamily: Schema.String,
  })

const spacingThemeGroupSchema: Schema.Schema<OpenWaggleExtensionThemeTokens['spacing']> =
  Schema.Struct({
    xs: Schema.String,
    sm: Schema.String,
    md: Schema.String,
    lg: Schema.String,
    xl: Schema.String,
  })

const radiusThemeGroupSchema: Schema.Schema<OpenWaggleExtensionThemeTokens['radius']> =
  Schema.Struct({
    sm: Schema.String,
    md: Schema.String,
    lg: Schema.String,
    panel: Schema.String,
  })

const focusThemeGroupSchema: Schema.Schema<OpenWaggleExtensionThemeTokens['focus']> = Schema.Struct(
  {
    ring: Schema.String,
    shadow: Schema.String,
  },
)

const elevationThemeGroupSchema: Schema.Schema<OpenWaggleExtensionThemeTokens['elevation']> =
  Schema.Struct({
    card: Schema.String,
    overlay: Schema.String,
  })

export const extensionThemeTokensSchema: Schema.Schema<OpenWaggleExtensionThemeTokens> =
  Schema.Struct({
    color: colorThemeGroupSchema,
    typography: typographyThemeGroupSchema,
    spacing: spacingThemeGroupSchema,
    radius: radiusThemeGroupSchema,
    focus: focusThemeGroupSchema,
    elevation: elevationThemeGroupSchema,
  })

export const extensionThemeCssVariablesSchema: Schema.Schema<OpenWaggleExtensionThemeCssVariables> =
  extensionThemeTokensSchema

export const extensionThemeSchema: Schema.Schema<OpenWaggleExtensionTheme> = Schema.Struct({
  colorScheme: Schema.Literal('dark'),
  tokens: extensionThemeTokensSchema,
  cssVariables: extensionThemeCssVariablesSchema,
})

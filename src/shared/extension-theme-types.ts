export type OpenWaggleExtensionColorScheme = 'dark'

export interface OpenWaggleExtensionThemeTokens {
  readonly color: {
    readonly background: string
    readonly surface: string
    readonly surfaceRaised: string
    readonly surfaceHover: string
    readonly surfaceActive: string
    readonly border: string
    readonly borderStrong: string
    readonly text: string
    readonly textSubtle: string
    readonly textMuted: string
    readonly textDim: string
    readonly accent: string
    readonly accentDim: string
    readonly success: string
    readonly danger: string
    readonly warning: string
    readonly info: string
  }
  readonly typography: {
    readonly sansFamily: string
    readonly monoFamily: string
  }
  readonly spacing: {
    readonly xs: string
    readonly sm: string
    readonly md: string
    readonly lg: string
    readonly xl: string
  }
  readonly radius: {
    readonly sm: string
    readonly md: string
    readonly lg: string
    readonly panel: string
  }
  readonly focus: {
    readonly ring: string
    readonly shadow: string
  }
  readonly elevation: {
    readonly card: string
    readonly overlay: string
  }
}

export type OpenWaggleExtensionThemeCssVariables = OpenWaggleExtensionThemeTokens

export interface OpenWaggleExtensionTheme {
  readonly colorScheme: OpenWaggleExtensionColorScheme
  readonly tokens: OpenWaggleExtensionThemeTokens
  readonly cssVariables: OpenWaggleExtensionThemeCssVariables
}

export interface OpenWaggleExtensionThemeCssVariableEntry {
  readonly name: string
  readonly value: string
}

export type ExtensionThemeCssVariableResolver = (cssVariable: string, fallback: string) => string

export interface CreateOpenWaggleExtensionThemeOptions {
  readonly resolveCssVariable?: ExtensionThemeCssVariableResolver
}

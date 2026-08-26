export type OpenWaggleExtensionColorScheme = 'dark' | 'light'

export interface OpenWaggleExtensionTypeScaleEntry {
  readonly fontSize: string
  readonly lineHeight: string
}

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
    readonly dangerText: string
    readonly warning: string
    readonly info: string
    readonly infoText: string
    readonly review: string
    readonly plan: string
    readonly progress: string
    readonly neutral: string
  }
  readonly typography: {
    readonly sansFamily: string
    readonly monoFamily: string
    readonly typeScale: {
      readonly xs: OpenWaggleExtensionTypeScaleEntry
      readonly sm: OpenWaggleExtensionTypeScaleEntry
      readonly base: OpenWaggleExtensionTypeScaleEntry
      readonly lg: OpenWaggleExtensionTypeScaleEntry
      readonly xl: OpenWaggleExtensionTypeScaleEntry
      readonly twoXl: OpenWaggleExtensionTypeScaleEntry
    }
  }
  readonly spacing: {
    readonly unit: string
  }
  readonly radius: {
    readonly xs: string
    readonly sm: string
    readonly md: string
    readonly lg: string
    readonly xl: string
    readonly twoXl: string
    readonly threeXl: string
    readonly fourXl: string
  }
  readonly shadow: {
    readonly twoXs: string
    readonly xs: string
    readonly sm: string
    readonly md: string
    readonly lg: string
    readonly xl: string
    readonly twoXl: string
  }
  readonly focus: {
    readonly ring: string
    readonly shadow: string
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

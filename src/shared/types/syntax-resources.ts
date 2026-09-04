import type { JsonObject } from './json'
import type { SyntaxAppearanceVariant, SyntaxThemeId } from './syntax'

export type SyntaxResourceScope = 'bundled' | 'user' | 'project'
export type SyntaxImportFormat =
  | 'vscode-json'
  | 'textmate-plist'
  | 'vscode-vsix'
  | 'vscode-extension'
  | 'openwaggle'
export type SyntaxGrammarEngine = 'javascript' | 'oniguruma'

export interface SyntaxThemeTokenSettings {
  readonly foreground?: string
  readonly background?: string
  readonly fontStyle?: string
}

export interface SyntaxThemeTokenRule {
  readonly name?: string
  readonly scope?: string | readonly string[]
  readonly settings: SyntaxThemeTokenSettings
}

export interface SyntaxThemeRegistration {
  readonly name: string
  readonly displayName: string
  readonly type: 'light' | 'dark'
  readonly colors: Readonly<Record<string, string>>
  readonly settings: readonly SyntaxThemeTokenRule[]
}

export type SyntaxLanguagePair = readonly [open: string, close: string]

export interface SyntaxLanguageAutoClosingPair {
  readonly open: string
  readonly close: string
  readonly notIn?: readonly ('string' | 'comment' | 'regex')[]
}

export interface SyntaxLanguageConfiguration {
  readonly comments?: {
    readonly lineComment?: string
    readonly blockComment?: SyntaxLanguagePair
  }
  readonly brackets?: readonly SyntaxLanguagePair[]
  readonly autoClosingPairs?: readonly SyntaxLanguageAutoClosingPair[]
  readonly surroundingPairs?: readonly SyntaxLanguageAutoClosingPair[]
  readonly colorizedBracketPairs?: readonly SyntaxLanguagePair[]
  readonly autoCloseBefore?: string
}

export interface SyntaxThemeResource {
  readonly id: SyntaxThemeId
  readonly packageId: string
  readonly revision: string
  readonly label: string
  readonly variant: SyntaxAppearanceVariant
  readonly scope: SyntaxResourceScope
  readonly format: SyntaxImportFormat
  readonly sourcePath: string
  readonly theme: SyntaxThemeRegistration
  /** Original declarative source, retained losslessly for forward compatibility. */
  readonly original: JsonObject
}

/**
 * A validated, currently dormant semantic-token payload carried by a native theme package.
 * Syntax can ship now under the same stable package identity that app chrome will consume later.
 */
export interface SyntaxAppearanceResource {
  readonly id: string
  readonly packageId: string
  readonly revision: string
  readonly label: string
  readonly variant: SyntaxAppearanceVariant
  readonly scope: SyntaxResourceScope
  readonly format: 'openwaggle'
  readonly sourcePath: string
  readonly tokens: JsonObject
  readonly original: JsonObject
}

export interface SyntaxLanguageRegistration {
  readonly name: string
  readonly displayName: string
  readonly scopeName: string
  readonly aliases: readonly string[]
  readonly fileExtensions: readonly string[]
  readonly fileNames: readonly string[]
  readonly embeddedLanguages: Readonly<Record<string, string>>
  readonly injectTo: readonly string[]
  readonly grammar: JsonObject
  readonly configuration?: SyntaxLanguageConfiguration
}

export interface SyntaxLanguageResource {
  readonly id: string
  readonly packageId: string
  readonly revision: string
  readonly label: string
  readonly languageId: string
  readonly scope: SyntaxResourceScope
  readonly format: SyntaxImportFormat
  readonly sourcePath: string
  readonly engine: SyntaxGrammarEngine
  readonly registration: SyntaxLanguageRegistration
  /** Original manifest/declaration fields, retained losslessly for compatibility. */
  readonly original: JsonObject
}

export interface SyntaxResourceCatalog {
  readonly themes: readonly SyntaxThemeResource[]
  readonly languages: readonly SyntaxLanguageResource[]
  readonly appearances: readonly SyntaxAppearanceResource[]
}

export interface SyntaxThemeImportPreview {
  readonly token: string
  readonly sourcePath: string
  readonly themes: readonly SyntaxThemeResource[]
  readonly languages: readonly SyntaxLanguageResource[]
  readonly appearances: readonly SyntaxAppearanceResource[]
  readonly replacements: readonly string[]
  readonly warnings: readonly string[]
}

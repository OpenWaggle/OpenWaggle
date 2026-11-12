import { Option } from 'effect'
import { Schema, type SchemaType } from '@shared/schema'
import {
  anyObjectSchema,
  lenientArray,
  lenientOptional,
  lenientStringRecordSchema,
} from '@shared/schemas/lenient'
import type {
  SyntaxLanguageAutoClosingPair,
  SyntaxLanguagePair,
} from '@shared/types/syntax-resources'

/**
 * The parts of imported syntax sources (VS Code manifests, TextMate grammars and themes,
 * language configurations, native packages) that the importers read. These files come from
 * third-party packages, so a field of the wrong type reads as absent, as the importers always
 * treated it; the importer then decides whether a missing field is an error.
 */

const stringListSchema = lenientArray(Schema.String)

const pairSchema: Schema.Schema<SyntaxLanguagePair> = Schema.Tuple(Schema.String, Schema.String)

const autoClosingObjectSchema = Schema.Struct({
  open: Schema.String,
  close: Schema.String,
  notIn: lenientArray(Schema.Literal('string', 'comment', 'regex')),
})

/** A `[open, close]` pair or an `{ open, close, notIn }` object, as VS Code accepts both. */
const autoClosingPairSchema = Schema.transform(
  Schema.Union(pairSchema, autoClosingObjectSchema),
  Schema.typeSchema(
    Schema.Struct({
      open: Schema.String,
      close: Schema.String,
      notIn: Schema.optionalWith(Schema.Array(Schema.Literal('string', 'comment', 'regex')), {
        exact: true,
      }),
    }),
  ),
  {
    strict: true,
    decode: (pair): SyntaxLanguageAutoClosingPair => {
      if (!('open' in pair)) return { open: pair[0], close: pair[1] }
      return {
        open: pair.open,
        close: pair.close,
        ...(pair.notIn.length > 0 ? { notIn: pair.notIn } : {}),
      }
    },
    encode: (pair) => ({ open: pair.open, close: pair.close, notIn: pair.notIn ?? [] }),
  },
)

export const languageConfigurationSourceSchema = Schema.Struct({
  comments: lenientOptional(
    Schema.Struct({
      lineComment: lenientOptional(Schema.String),
      blockComment: lenientOptional(pairSchema),
    }),
  ),
  brackets: lenientArray(pairSchema),
  autoClosingPairs: lenientArray(autoClosingPairSchema),
  surroundingPairs: lenientArray(autoClosingPairSchema),
  colorizedBracketPairs: lenientArray(pairSchema),
  autoCloseBefore: lenientOptional(Schema.String),
})

/** A grammar declaration: a VS Code `contributes.grammars` entry, or a grammar file itself. */
export const grammarDeclarationSourceSchema = Schema.Struct({
  scopeName: lenientOptional(Schema.String),
  language: lenientOptional(Schema.String),
  embeddedLanguages: lenientStringRecordSchema,
  injectTo: stringListSchema,
})

/** A VS Code `contributes.languages` entry. */
export const languageDeclarationSourceSchema = Schema.Struct({
  id: lenientOptional(Schema.String),
  aliases: stringListSchema,
  extensions: stringListSchema,
  filenames: stringListSchema,
  configuration: lenientOptional(Schema.String),
})

export type LanguageDeclarationSource = SchemaType<typeof languageDeclarationSourceSchema>

/** The top of a TextMate grammar. */
export const grammarSourceSchema = Schema.Struct({
  scopeName: lenientOptional(Schema.String),
  name: lenientOptional(Schema.String),
  patterns: lenientOptional(Schema.Array(Schema.Unknown)),
  repository: lenientOptional(anyObjectSchema),
})

const tokenRuleSourceSchema = Schema.Struct({
  name: lenientOptional(Schema.String),
  scope: lenientOptional(Schema.Union(Schema.String, Schema.Array(Schema.String))),
  settings: Schema.Struct({
    foreground: lenientOptional(Schema.String),
    background: lenientOptional(Schema.String),
    fontStyle: lenientOptional(Schema.String),
  }),
})

/** A VS Code theme or TextMate theme; `tokenColors` and `settings` are the same rule list. */
export const themeSourceSchema = Schema.Struct({
  name: lenientOptional(Schema.String),
  type: lenientOptional(Schema.String),
  include: lenientOptional(Schema.String),
  colors: lenientStringRecordSchema,
  tokenColors: Schema.optionalWith(Schema.Unknown, { exact: true }),
  settings: Schema.optionalWith(Schema.Unknown, { exact: true }),
})

export const themeTokenRulesSchema = lenientArray(tokenRuleSourceSchema)

const resourcePathSchema = Schema.Struct({ path: Schema.String })

/** A VS Code `contributes.themes` entry. */
export const themeContributionSchema = Schema.Struct({
  path: Schema.String,
  label: lenientOptional(Schema.String),
  uiTheme: lenientOptional(Schema.String),
  id: lenientOptional(Schema.String),
})

/** The parts of a VS Code extension `package.json` the syntax importer reads. */
export const extensionManifestSourceSchema = Schema.Struct({
  publisher: lenientOptional(Schema.String),
  name: lenientOptional(Schema.String),
  contributes: lenientOptional(
    Schema.Struct({
      themes: lenientOptional(Schema.Array(Schema.Unknown)),
      grammars: lenientOptional(Schema.Array(Schema.Unknown)),
      languages: lenientOptional(Schema.Array(Schema.Unknown)),
    }),
  ),
})

/** An entry that names a resource file by `path`; other entries are not resources. */
export const hasResourcePath = Schema.is(resourcePathSchema)

/** Any object but an array. */
export const isSourceObject = Schema.is(anyObjectSchema)

/** Decode a source the importer already knows is an object; every field is lenient. */
export function decodeSource<A, I>(schema: Schema.Schema<A, I>, value: unknown): A | undefined {
  if (!isSourceObject(value)) return undefined
  return Option.getOrUndefined(Schema.decodeUnknownOption(schema)(value))
}

const appearanceVariantSchema = Schema.Literal(
  'light',
  'dark',
  'high-contrast-light',
  'high-contrast-dark',
)

/** An OpenWaggle native syntax package (`schemaVersion: 1`). */
export const nativePackageSourceSchema = Schema.Struct({
  schemaVersion: Schema.optionalWith(Schema.Unknown, { exact: true }),
  publisher: lenientOptional(Schema.String),
  name: lenientOptional(Schema.String),
  themes: lenientOptional(Schema.Array(Schema.Unknown)),
  languages: lenientOptional(Schema.Array(Schema.Unknown)),
  appearances: lenientOptional(Schema.Array(Schema.Unknown)),
})

export const nativeThemeEntrySchema = Schema.Struct({
  theme: Schema.optionalWith(Schema.Unknown, { exact: true }),
  variant: lenientOptional(appearanceVariantSchema),
  label: lenientOptional(Schema.String),
})

export const nativeLanguageEntrySchema = Schema.Struct({
  grammar: Schema.optionalWith(Schema.Unknown, { exact: true }),
  language: Schema.optionalWith(Schema.Unknown, { exact: true }),
  configuration: Schema.optionalWith(Schema.Unknown, { exact: true }),
})

export const nativeAppearanceEntrySchema = Schema.Struct({
  tokens: Schema.optionalWith(Schema.Unknown, { exact: true }),
  variant: lenientOptional(appearanceVariantSchema),
  label: lenientOptional(Schema.String),
})

/** The semantic token groups a native appearance must declare, each an object. */
export const hasCompleteAppearanceTokenGroups = Schema.is(
  Schema.Struct({
    color: anyObjectSchema,
    typography: anyObjectSchema,
    spacing: anyObjectSchema,
    radius: anyObjectSchema,
    shadow: anyObjectSchema,
    focus: anyObjectSchema,
  }),
)

import { createHash } from 'node:crypto'
import type { JsonObject } from '@shared/types/json'
import { decodeUnknownOrThrow, type SchemaType } from '@shared/schema'
import type {
  SyntaxImportFormat,
  SyntaxLanguageConfiguration,
  SyntaxLanguageResource,
  SyntaxResourceScope,
} from '@shared/types/syntax-resources'
import { syntaxResourceSlug, toJsonObject } from './syntax-resource-import-utils'
import {
  grammarDeclarationSourceSchema,
  grammarSourceSchema,
  isSourceObject,
  type LanguageDeclarationSource,
  languageConfigurationSourceSchema,
  languageDeclarationSourceSchema,
} from './syntax-source-schemas'

function normalizedLanguageConfiguration(value: unknown) {
  if (!isSourceObject(value)) return undefined
  const source = decodeUnknownOrThrow(languageConfigurationSourceSchema, value)
  const { brackets, autoClosingPairs, surroundingPairs, colorizedBracketPairs } = source
  const lineComment = source.comments?.lineComment
  const blockComment = source.comments?.blockComment
  const comments = source.comments
    ? {
        ...(lineComment === undefined ? {} : { lineComment }),
        ...(blockComment ? { blockComment } : {}),
      }
    : undefined
  const configuration: SyntaxLanguageConfiguration = {
    ...(comments && Object.keys(comments).length > 0 ? { comments } : {}),
    ...(brackets.length > 0 ? { brackets } : {}),
    ...(autoClosingPairs.length > 0 ? { autoClosingPairs } : {}),
    ...(surroundingPairs.length > 0 ? { surroundingPairs } : {}),
    ...(colorizedBracketPairs.length > 0 ? { colorizedBracketPairs } : {}),
    ...(source.autoCloseBefore === undefined ? {} : { autoCloseBefore: source.autoCloseBefore }),
  }
  const result: SyntaxLanguageConfiguration | undefined =
    Object.keys(configuration).length > 0 ? configuration : undefined
  return result
}

function normalizedExtension(value: string) {
  const trimmed = value.trim().toLowerCase()
  if (!trimmed) return null
  return trimmed.startsWith('.') ? trimmed : `.${trimmed}`
}

function grammarNeedsOniguruma(grammar: JsonObject) {
  const source = JSON.stringify(grammar)
  return /\\[AGKRz]|\(\?<=[^)]|\(\?<!|\(\?>|\(\?\(/u.test(source)
}

type GrammarDeclarationSource = SchemaType<typeof grammarDeclarationSourceSchema>
type GrammarSource = SchemaType<typeof grammarSourceSchema>

function grammarLanguageId(
  declaration: GrammarDeclarationSource,
  language: LanguageDeclarationSource | undefined,
  scopeName: string,
) {
  return declaration.language ?? language?.id ?? scopeName.replace(/^(?:source|text)\./u, '')
}

function grammarLabel(aliases: readonly string[], languageId: string, grammar: GrammarSource) {
  const namedAlias = aliases.find((entry) => entry !== languageId.toLowerCase())
  if (namedAlias) return namedAlias
  return grammar.name ?? languageId
}

function grammarIdentity(
  grammar: GrammarSource,
  declaration: GrammarDeclarationSource,
  language: LanguageDeclarationSource | undefined,
) {
  const scopeName = declaration.scopeName ?? grammar.scopeName ?? null
  if (!scopeName || !/^[A-Za-z0-9_.+-]+$/u.test(scopeName)) {
    throw new Error('TextMate grammar has an invalid or missing scopeName.')
  }
  if (grammar.patterns === undefined || grammar.repository === undefined) {
    throw new Error(`Grammar "${scopeName}" must declare patterns and repository.`)
  }
  const languageId = grammarLanguageId(declaration, language, scopeName)
  if (!/^[A-Za-z0-9_.+-]+$/u.test(languageId)) {
    throw new Error(`Grammar "${scopeName}" has an invalid language identity.`)
  }
  return { scopeName, languageId }
}

export function normalizedLanguage(input: {
  readonly grammar: unknown
  readonly declaration: JsonObject
  readonly language: JsonObject | undefined
  readonly packageId: string
  readonly format: SyntaxImportFormat
  readonly sourcePath: string
  readonly scope: SyntaxResourceScope
  readonly configuration?: unknown
}) {
  if (!isSourceObject(input.grammar)) throw new Error('TextMate grammar must contain an object.')
  const grammar = toJsonObject(input.grammar)
  const grammarSource = decodeUnknownOrThrow(grammarSourceSchema, grammar)
  const declaration = decodeUnknownOrThrow(grammarDeclarationSourceSchema, input.declaration)
  const language = input.language
    ? decodeUnknownOrThrow(languageDeclarationSourceSchema, input.language)
    : undefined
  const { scopeName, languageId } = grammarIdentity(grammarSource, declaration, language)
  const aliases = [languageId, ...(language?.aliases ?? [])].map((entry) => entry.toLowerCase())
  const fileExtensions = (language?.extensions ?? [])
    .map(normalizedExtension)
    .filter((entry): entry is string => entry !== null)
  const fileNames = language?.filenames ?? []
  const { embeddedLanguages } = declaration
  const label = grammarLabel(aliases, languageId, grammarSource)
  const rawConfiguration = input.configuration
  const configuration = normalizedLanguageConfiguration(rawConfiguration)
  const original = toJsonObject({
    declaration: input.declaration,
    ...(input.language ? { language: input.language } : {}),
    grammar,
    ...(isSourceObject(rawConfiguration) ? { configuration: rawConfiguration } : {}),
  })
  const revision = createHash('sha256').update(JSON.stringify(original)).digest('hex')
  const resource: SyntaxLanguageResource = {
    id: `language:${syntaxResourceSlug(input.packageId)}:${syntaxResourceSlug(languageId)}`,
    packageId: input.packageId,
    revision,
    label,
    languageId,
    scope: input.scope,
    format: input.format,
    sourcePath: input.sourcePath,
    engine: grammarNeedsOniguruma(grammar) ? 'oniguruma' : 'javascript',
    registration: {
      name: languageId,
      displayName: label,
      scopeName,
      aliases: [...new Set(aliases)],
      fileExtensions: [...new Set(fileExtensions)],
      fileNames: [...new Set(fileNames)],
      embeddedLanguages,
      injectTo: declaration.injectTo,
      grammar,
      ...(configuration ? { configuration } : {}),
    },
    original,
  }
  return resource
}

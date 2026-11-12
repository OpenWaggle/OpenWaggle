import { createHash } from 'node:crypto'
import type { JsonObject } from '@shared/types/json'
import type {
  SyntaxImportFormat,
  SyntaxLanguageAutoClosingPair,
  SyntaxLanguageConfiguration,
  SyntaxLanguagePair,
  SyntaxLanguageResource,
  SyntaxResourceScope,
} from '@shared/types/syntax-resources'
import {
  isRecord,
  stringArray,
  stringRecord,
  syntaxResourceSlug,
  toJsonObject,
} from './syntax-resource-import-utils'

const AUTO_CLOSE_CONTEXTS = new Set(['string', 'comment', 'regex'])
const PAIR_LENGTH = 2

function normalizedPair(value: unknown): SyntaxLanguagePair | null {
  if (
    !Array.isArray(value) ||
    value.length !== PAIR_LENGTH ||
    typeof value[0] !== 'string' ||
    typeof value[1] !== 'string'
  ) {
    return null
  }
  return [value[0], value[1]]
}

function normalizedPairs(value: unknown) {
  if (!Array.isArray(value)) return []
  return value.map(normalizedPair).filter((pair): pair is SyntaxLanguagePair => pair !== null)
}

function normalizedAutoClosingPair(value: unknown): SyntaxLanguageAutoClosingPair | null {
  const pair = normalizedPair(value)
  if (pair) return { open: pair[0], close: pair[1] }
  if (!isRecord(value) || typeof value.open !== 'string' || typeof value.close !== 'string') {
    return null
  }
  const notIn = stringArray(value.notIn).filter((entry): entry is 'string' | 'comment' | 'regex' =>
    AUTO_CLOSE_CONTEXTS.has(entry),
  )
  return {
    open: value.open,
    close: value.close,
    ...(notIn.length > 0 ? { notIn } : {}),
  }
}

function normalizedAutoClosingPairs(value: unknown) {
  if (!Array.isArray(value)) return []
  return value
    .map(normalizedAutoClosingPair)
    .filter((pair): pair is SyntaxLanguageAutoClosingPair => pair !== null)
}

function normalizedLanguageConfiguration(value: unknown): SyntaxLanguageConfiguration | undefined {
  if (!isRecord(value)) return undefined
  const blockComment = isRecord(value.comments) ? normalizedPair(value.comments.blockComment) : null
  const comments = isRecord(value.comments)
    ? {
        ...(typeof value.comments.lineComment === 'string'
          ? { lineComment: value.comments.lineComment }
          : {}),
        ...(blockComment ? { blockComment } : {}),
      }
    : undefined
  const brackets = normalizedPairs(value.brackets)
  const autoClosingPairs = normalizedAutoClosingPairs(value.autoClosingPairs)
  const surroundingPairs = normalizedAutoClosingPairs(value.surroundingPairs)
  const colorizedBracketPairs = normalizedPairs(value.colorizedBracketPairs)
  const configuration: SyntaxLanguageConfiguration = {
    ...(comments && Object.keys(comments).length > 0 ? { comments } : {}),
    ...(brackets.length > 0 ? { brackets } : {}),
    ...(autoClosingPairs.length > 0 ? { autoClosingPairs } : {}),
    ...(surroundingPairs.length > 0 ? { surroundingPairs } : {}),
    ...(colorizedBracketPairs.length > 0 ? { colorizedBracketPairs } : {}),
    ...(typeof value.autoCloseBefore === 'string'
      ? { autoCloseBefore: value.autoCloseBefore }
      : {}),
  }
  return Object.keys(configuration).length > 0 ? configuration : undefined
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

function grammarScopeName(
  declaration: Readonly<Record<string, unknown>>,
  grammar: Readonly<Record<string, unknown>>,
) {
  if (typeof declaration.scopeName === 'string') return declaration.scopeName
  if (typeof grammar.scopeName === 'string') return grammar.scopeName
  return null
}

function grammarLanguageId(
  declaration: Readonly<Record<string, unknown>>,
  language: Readonly<Record<string, unknown>> | undefined,
  scopeName: string,
) {
  if (typeof declaration.language === 'string') return declaration.language
  if (typeof language?.id === 'string') return language.id
  return scopeName.replace(/^(?:source|text)\./u, '')
}

function grammarLabel(
  aliases: readonly string[],
  languageId: string,
  grammar: Readonly<Record<string, unknown>>,
) {
  const namedAlias = aliases.find((entry) => entry !== languageId.toLowerCase())
  if (namedAlias) return namedAlias
  return typeof grammar.name === 'string' ? grammar.name : languageId
}

export function normalizedLanguage(input: {
  readonly grammar: unknown
  readonly declaration: Readonly<Record<string, unknown>>
  readonly language: Readonly<Record<string, unknown>> | undefined
  readonly packageId: string
  readonly format: SyntaxImportFormat
  readonly sourcePath: string
  readonly scope: SyntaxResourceScope
  readonly configuration?: unknown
}): SyntaxLanguageResource {
  if (!isRecord(input.grammar)) throw new Error('TextMate grammar must contain an object.')
  const grammar = toJsonObject(input.grammar)
  const scopeName = grammarScopeName(input.declaration, input.grammar)
  if (!scopeName || !/^[A-Za-z0-9_.+-]+$/u.test(scopeName)) {
    throw new Error('TextMate grammar has an invalid or missing scopeName.')
  }
  if (!Array.isArray(input.grammar.patterns) || !isRecord(input.grammar.repository)) {
    throw new Error(`Grammar "${scopeName}" must declare patterns and repository.`)
  }
  const languageId = grammarLanguageId(input.declaration, input.language, scopeName)
  if (!/^[A-Za-z0-9_.+-]+$/u.test(languageId)) {
    throw new Error(`Grammar "${scopeName}" has an invalid language identity.`)
  }
  const aliases = [languageId, ...stringArray(input.language?.aliases)].map((entry) =>
    entry.toLowerCase(),
  )
  const fileExtensions = stringArray(input.language?.extensions)
    .map(normalizedExtension)
    .filter((entry): entry is string => entry !== null)
  const fileNames = stringArray(input.language?.filenames)
  const embeddedLanguages = stringRecord(input.declaration.embeddedLanguages)
  const label = grammarLabel(aliases, languageId, input.grammar)
  const rawConfiguration = input.configuration
  const configuration = normalizedLanguageConfiguration(rawConfiguration)
  const original = toJsonObject({
    declaration: input.declaration,
    ...(input.language ? { language: input.language } : {}),
    grammar,
    ...(isRecord(rawConfiguration) ? { configuration: rawConfiguration } : {}),
  })
  const revision = createHash('sha256').update(JSON.stringify(original)).digest('hex')
  return {
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
      injectTo: stringArray(input.declaration.injectTo),
      grammar,
      ...(configuration ? { configuration } : {}),
    },
    original,
  }
}

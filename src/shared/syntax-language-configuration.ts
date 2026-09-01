import type {
  SyntaxLanguageAutoClosingPair,
  SyntaxLanguageConfiguration,
  SyntaxLanguagePair,
} from './types/syntax-resources'

const PAIR_LENGTH = 2

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isPair(value: unknown): value is SyntaxLanguagePair {
  return (
    Array.isArray(value) &&
    value.length === PAIR_LENGTH &&
    typeof value[0] === 'string' &&
    typeof value[1] === 'string'
  )
}

function isAutoClosingPair(value: unknown): value is SyntaxLanguageAutoClosingPair {
  return (
    isRecord(value) &&
    typeof value.open === 'string' &&
    typeof value.close === 'string' &&
    (value.notIn === undefined ||
      (Array.isArray(value.notIn) &&
        value.notIn.every(
          (entry) => entry === 'string' || entry === 'comment' || entry === 'regex',
        )))
  )
}

function isOptionalPairList(value: unknown) {
  return value === undefined || (Array.isArray(value) && value.every(isPair))
}

function isOptionalAutoClosingPairList(value: unknown) {
  return value === undefined || (Array.isArray(value) && value.every(isAutoClosingPair))
}

function isOptionalComments(value: unknown) {
  if (value === undefined) return true
  return (
    isRecord(value) &&
    (value.lineComment === undefined || typeof value.lineComment === 'string') &&
    (value.blockComment === undefined || isPair(value.blockComment))
  )
}

export function isSyntaxLanguageConfiguration(
  value: unknown,
): value is SyntaxLanguageConfiguration {
  if (!isRecord(value)) return false
  return (
    isOptionalComments(value.comments) &&
    isOptionalPairList(value.brackets) &&
    isOptionalAutoClosingPairList(value.autoClosingPairs) &&
    isOptionalAutoClosingPairList(value.surroundingPairs) &&
    isOptionalPairList(value.colorizedBracketPairs) &&
    (value.autoCloseBefore === undefined || typeof value.autoCloseBefore === 'string')
  )
}

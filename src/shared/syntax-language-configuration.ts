import type {
  SyntaxLanguageAutoClosingPair,
  SyntaxLanguageConfiguration,
  SyntaxLanguagePair,
} from './types/syntax-resources'
import { isObjectValue } from './utils/object-shape'

const PAIR_LENGTH = 2

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
    isObjectValue(value) &&
    'open' in value &&
    typeof value.open === 'string' &&
    'close' in value &&
    typeof value.close === 'string' &&
    (!('notIn' in value) ||
      value.notIn === undefined ||
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
    isObjectValue(value) &&
    (!('lineComment' in value) ||
      value.lineComment === undefined ||
      typeof value.lineComment === 'string') &&
    (!('blockComment' in value) || value.blockComment === undefined || isPair(value.blockComment))
  )
}

export function isSyntaxLanguageConfiguration(
  value: unknown,
): value is SyntaxLanguageConfiguration {
  if (!isObjectValue(value)) return false
  return (
    isOptionalComments('comments' in value ? value.comments : undefined) &&
    isOptionalPairList('brackets' in value ? value.brackets : undefined) &&
    isOptionalAutoClosingPairList(
      'autoClosingPairs' in value ? value.autoClosingPairs : undefined,
    ) &&
    isOptionalAutoClosingPairList(
      'surroundingPairs' in value ? value.surroundingPairs : undefined,
    ) &&
    isOptionalPairList(
      'colorizedBracketPairs' in value ? value.colorizedBracketPairs : undefined,
    ) &&
    (!('autoCloseBefore' in value) ||
      value.autoCloseBefore === undefined ||
      typeof value.autoCloseBefore === 'string')
  )
}

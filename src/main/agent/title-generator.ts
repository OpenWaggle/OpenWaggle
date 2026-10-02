import { TITLE } from '@shared/constants/text-processing'
import { DEFAULT_SESSION_TITLE } from '@shared/session-title-source'

const TITLE_WORD_SEPARATOR = ' '

/**
 * Remove consecutive duplicate words/fragments from a title.
 */
export function deduplicateConsecutiveWords(title: string): string {
  let result = title.replace(/\b(\w+)\s+\1\b/gi, '$1')
  result = result.replace(/\b(\w{4,})\1\b/gi, '$1')
  return result
}

/**
 * Controls and bidi overrides would reach the sidebar, header, and window title, and a Worker's
 * objective, which a Provisional title is cut from, can come from another model.
 */
const UNSAFE_CHARACTERS = /[\p{Cc}\u200e\u200f\u202a-\u202e\u2066-\u2069]/gu

/** Cuts by code point, so an emoji or astral character is never split into a lone surrogate. */
function truncateTitle(text: string) {
  if (text.length <= TITLE.FALLBACK_LENGTH) {
    return text
  }

  let truncated = ''
  for (const character of text) {
    if (truncated.length + character.length > TITLE.FALLBACK_LENGTH) break
    truncated += character
  }
  const lastSpace = truncated.lastIndexOf(TITLE_WORD_SEPARATOR)
  const candidate = lastSpace > 0 ? truncated.slice(0, lastSpace) : truncated
  return `${candidate}...`
}

function normalizeTitleInput(text: string) {
  return text
    .slice(0, TITLE.INPUT_MAX_CHARS)
    .split(/\r?\n/)
    .map((line) => line.replace(UNSAFE_CHARACTERS, TITLE_WORD_SEPARATOR).trim())
    .filter((line) => line.length > 0)
    .join(TITLE_WORD_SEPARATOR)
    .replace(/\s+/g, TITLE_WORD_SEPARATOR)
}

export function buildDeterministicTitle(text: string): string {
  const normalized = deduplicateConsecutiveWords(normalizeTitleInput(text)).trim()
  if (!normalized) {
    return DEFAULT_SESSION_TITLE
  }
  return truncateTitle(normalized)
}

import { TITLE } from '@shared/constants/text-processing'

const TITLE_WORD_SEPARATOR = ' '

/**
 * Remove consecutive duplicate words/fragments from a title.
 */
export function deduplicateConsecutiveWords(title: string): string {
  let result = title.replace(/\b(\w+)\s+\1\b/gi, '$1')
  result = result.replace(/\b(\w{4,})\1\b/gi, '$1')
  return result
}

function truncateTitle(text: string): string {
  if (text.length <= TITLE.FALLBACK_LENGTH) {
    return text
  }

  const truncated = text.slice(0, TITLE.FALLBACK_LENGTH)
  const lastSpace = truncated.lastIndexOf(TITLE_WORD_SEPARATOR)
  const candidate = lastSpace > 0 ? truncated.slice(0, lastSpace) : truncated
  return `${candidate}...`
}

function normalizeTitleInput(text: string): string {
  return text
    .slice(0, TITLE.INPUT_MAX_CHARS)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join(TITLE_WORD_SEPARATOR)
    .replace(/\s+/g, TITLE_WORD_SEPARATOR)
}

export function buildDeterministicTitle(text: string): string {
  const normalized = deduplicateConsecutiveWords(normalizeTitleInput(text)).trim()
  if (!normalized) {
    return 'New session'
  }
  return truncateTitle(normalized)
}

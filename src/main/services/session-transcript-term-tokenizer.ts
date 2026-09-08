const UNICODE61_TOKEN_PATTERN = /[\p{L}\p{N}\p{Co}]+/gu
const NON_ASCII_CHARACTER_PATTERN = /[^\p{ASCII}]/u
const COMBINING_MARK_PATTERN = /\p{M}+/gu
const LATIN_CHARACTER_PATTERN = /\p{Script=Latin}/u

function normalizeUnicode61Character(character: string) {
  return LATIN_CHARACTER_PATTERN.test(character)
    ? character.normalize('NFD').replace(COMBINING_MARK_PATTERN, '')
    : character
}

/** Locale-stable unicode61 normalization without deleting non-Latin combining marks. */
export function tokenizeSessionTranscriptTerms(value: string) {
  if (!NON_ASCII_CHARACTER_PATTERN.test(value)) {
    return value.toLowerCase().match(UNICODE61_TOKEN_PATTERN) ?? []
  }
  const normalized = [...value].map(normalizeUnicode61Character).join('').toLowerCase()
  return normalized.match(UNICODE61_TOKEN_PATTERN) ?? []
}

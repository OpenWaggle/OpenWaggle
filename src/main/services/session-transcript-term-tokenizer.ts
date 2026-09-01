const UNICODE61_TOKEN_PATTERN = /[\p{L}\p{N}\p{Co}]+/gu
const COMBINING_MARK_PATTERN = /\p{M}+/gu

/** Locale-stable approximation of SQLite unicode61 with remove_diacritics=2. */
export function tokenizeSessionTranscriptTerms(value: string) {
  const normalized = value.normalize('NFD').replace(COMBINING_MARK_PATTERN, '').toLowerCase()
  return normalized.match(UNICODE61_TOKEN_PATTERN) ?? []
}

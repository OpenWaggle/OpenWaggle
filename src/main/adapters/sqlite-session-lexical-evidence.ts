import { tokenizeSessionTranscriptTerms } from '../services/session-transcript-term-tokenizer'
import type { DiscoverySearchRow } from './sqlite-session-discovery-window'

const QUOTED_QUERY_DELIMITER_COUNT = 2
const DISCOVERY_SNIPPET_CHARACTER_LIMIT = 240
const SNIPPET_WINDOW_DIVISOR = 2

export interface LexicalDiscoverySearchRow extends DiscoverySearchRow {
  readonly discovery_initial_objective: string
  readonly discovery_current_preview: string
}

function containsTokenSequence(tokens: readonly string[], sequence: readonly string[]) {
  if (sequence.length === 0 || sequence.length > tokens.length) return false
  return tokens.some((_, start) =>
    sequence.every((term, offset) => tokens[start + offset] === term),
  )
}

function lexicalDiscoveryFieldMatches(value: string, exactQuery: string) {
  const explicitPhrase =
    exactQuery.length >= QUOTED_QUERY_DELIMITER_COUNT &&
    exactQuery.startsWith('"') &&
    exactQuery.endsWith('"')
  const clauses = (explicitPhrase ? [exactQuery.slice(1, -1)] : exactQuery.split(/\s+/u))
    .map(tokenizeSessionTranscriptTerms)
    .filter((clause) => clause.length > 0)
  const tokens = tokenizeSessionTranscriptTerms(value)
  return clauses.every((clause) => containsTokenSequence(tokens, clause))
}

function lexicalDiscoverySnippet(value: string, exactQuery: string) {
  if (value.length <= DISCOVERY_SNIPPET_CHARACTER_LIMIT) return value
  const queryTerms = tokenizeSessionTranscriptTerms(exactQuery)
  const lowerValue = value.toLowerCase()
  const firstMatch = queryTerms.reduce((earliest, term) => {
    const index = lowerValue.indexOf(term)
    return index >= 0 && (earliest < 0 || index < earliest) ? index : earliest
  }, -1)
  const halfWindow = Math.floor(DISCOVERY_SNIPPET_CHARACTER_LIMIT / SNIPPET_WINDOW_DIVISOR)
  const start = Math.max(0, firstMatch < 0 ? 0 : firstMatch - halfWindow)
  const end = Math.min(value.length, start + DISCOVERY_SNIPPET_CHARACTER_LIMIT)
  return `${start > 0 ? '… ' : ''}${value.slice(start, end)}${end < value.length ? ' …' : ''}`
}

export function decorateLexicalDiscoveryRows(
  rows: readonly LexicalDiscoverySearchRow[],
  exactQuery: string,
): readonly DiscoverySearchRow[] {
  return rows.map((row): DiscoverySearchRow => {
    const matchedFields = row.matched_fields.split(',')
    if (!matchedFields.includes('discovery')) return row
    const projectedFields = [
      ...(lexicalDiscoveryFieldMatches(row.discovery_initial_objective, exactQuery)
        ? ['initial-objective']
        : []),
      ...(lexicalDiscoveryFieldMatches(row.discovery_current_preview, exactQuery)
        ? ['current-preview']
        : []),
    ]
    const matchingDiscoveryText = projectedFields.includes('initial-objective')
      ? row.discovery_initial_objective
      : row.discovery_current_preview
    return {
      ...row,
      matched_fields: [
        ...matchedFields.filter((field) => field !== 'discovery'),
        ...projectedFields,
      ].join(','),
      snippet: row.snippet ?? lexicalDiscoverySnippet(matchingDiscoveryText, exactQuery),
    }
  })
}

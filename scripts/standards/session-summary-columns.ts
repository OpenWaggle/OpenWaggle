import path from 'node:path'

interface Violation {
  readonly detail?: string
  readonly file: string
  readonly message: string
}

const SESSION_SUMMARY_QUERY_PATTERN = /sql<SessionSummaryRow>`([^`]*)`/gsu
const SESSION_SUMMARY_COLUMN_FRAGMENT = 'sessionSummaryColumns'
const SESSION_SUMMARY_PROJECTION = /\bselect\b(?<projection>[\s\S]*?)\bfrom\b/iu
const AGGREGATE_TERM = /^\(?\s*\b(?:count|sum|min|max|avg)\s*\(/iu
const SESSION_SUMMARY_COLUMN_OWNERS: readonly string[] = [
  'src/main/store/session-details/session-queries.ts',
]

function normalizePath(filePath: string) {
  return filePath.split(path.sep).join('/')
}

function splitTopLevelTerms(projection: string): readonly string[] {
  const terms: string[] = []
  let depth = 0
  let current = ''
  for (const character of projection) {
    if (character === '(') depth += 1
    if (character === ')') depth -= 1
    if (character === ',' && depth === 0) {
      terms.push(current)
      current = ''
      continue
    }
    current += character
  }
  if (current.trim().length > 0) terms.push(current)
  return terms.filter((term) => term.trim().length > 0)
}

function namesNoColumns(projection: string) {
  const terms = splitTopLevelTerms(projection)
  if (terms.length === 0) return true
  return terms.every((term) => AGGREGATE_TERM.test(term.trim()))
}

function selectsNamedColumns(query: string) {
  const projection = SESSION_SUMMARY_PROJECTION.exec(query)?.groups?.['projection']
  if (projection === undefined) return false
  return !namesNoColumns(projection)
}

/**
 * `sql<Row>` asserts a row shape without checking the SELECT list. Require the shared Session
 * summary fragment anywhere production code requests SessionSummaryRow.
 */
export function collectSessionSummaryColumnViolations(file: string, contents: string) {
  const normalized = normalizePath(file)
  if (SESSION_SUMMARY_COLUMN_OWNERS.includes(normalized)) return []
  if (normalized.includes('__tests__')) return []
  const violations: Violation[] = []
  for (const match of contents.matchAll(SESSION_SUMMARY_QUERY_PATTERN)) {
    const query = match[1] ?? ''
    if (query.includes(SESSION_SUMMARY_COLUMN_FRAGMENT)) continue
    if (!selectsNamedColumns(query)) continue
    violations.push({
      file: normalized,
      message:
        'SessionSummaryRow queries must interpolate sessionSummaryColumns(sql), not list columns inline',
      detail: 'an inline list can omit a column the row type promises, and the type checker cannot see it',
    })
  }
  return violations
}

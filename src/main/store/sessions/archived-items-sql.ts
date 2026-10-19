import type * as SqlClient from '@effect/sql/SqlClient'
import {
  ARCHIVED_ITEMS_MAX_TERMS,
  type ArchivedItemsFilter,
  type ArchivedItemsSort,
  type ArchivedWithinFilter,
} from '@shared/types/archived-items'
import { tokenizeSessionTranscriptTerms } from '../../services/session-transcript-term-tokenizer'

const DAY_MS = 86_400_000
const WEEK_DAYS = 7
const MONTH_DAYS = 30
/** The greatest code point: `term < prefix + this` bounds a prefix range in binary collation. */
const PREFIX_RANGE_END = '\u{10FFFF}'

/** Relevance per search term, best first: where in the item the term was found. */
export const ARCHIVED_MATCH_SCORE = {
  titleStart: 100,
  titleWordStart: 80,
  title: 60,
  context: 40,
  transcript: 20,
} as const

export interface ArchivedSearchTerm {
  /** The lowercased term, matched as a substring of the title, parent title, and project path. */
  readonly text: string
  /** The term's transcript tokens, each matched as a word prefix. */
  readonly tokens: readonly string[]
}

export interface ArchivedWithinBounds {
  readonly day: number
  readonly week: number
  readonly month: number
}

export function archivedWithinBounds(now: number): ArchivedWithinBounds {
  return { day: now - DAY_MS, week: now - WEEK_DAYS * DAY_MS, month: now - MONTH_DAYS * DAY_MS }
}

/** Whitespace-separated, deduplicated, capped at {@link ARCHIVED_ITEMS_MAX_TERMS}. */
export function archivedSearchTerms(text: string | undefined): readonly ArchivedSearchTerm[] {
  const words = [
    ...new Set(
      (text ?? '')
        .trim()
        .toLowerCase()
        .split(/\s+/u)
        .filter((word) => word.length > 0),
    ),
  ]
  return words.slice(0, ARCHIVED_ITEMS_MAX_TERMS).map((word) => ({
    text: word,
    tokens: [...new Set(tokenizeSessionTranscriptTerms(word))],
  }))
}

function likeEscape(value: string) {
  return value.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_')
}

export function prefixRange(token: string) {
  return { from: token, to: `${token}${PREFIX_RANGE_END}` }
}

function contains(sql: SqlClient.SqlClient, column: string, term: string) {
  return sql`lower(COALESCE(${sql.literal(column)}, '')) LIKE ${`%${likeEscape(term)}%`} ESCAPE '\\'`
}

function metadataMatch(sql: SqlClient.SqlClient, term: ArchivedSearchTerm) {
  return sql.or([
    contains(sql, 'archived_items.title', term.text),
    contains(sql, 'archived_items.parent_title', term.text),
    contains(sql, 'archived_items.project_path', term.text),
  ])
}

/**
 * Every token of the term begins a word of the session's transcript. The probe walks the
 * `(session_id, term)` index of one archived session at a time, so its cost follows the archive's
 * size rather than the whole transcript corpus. A session without a term document is stale
 * (ADR 0037) and its leftover terms do not count.
 */
function transcriptMatch(sql: SqlClient.SqlClient, term: ArchivedSearchTerm) {
  if (term.tokens.length === 0) return sql.literal('0')
  return sql.and([
    sql`archived_items.kind = 'session'`,
    sql`EXISTS (
      SELECT 1 FROM session_transcript_term_documents AS term_documents
      WHERE term_documents.session_id = archived_items.session_id
    )`,
    ...term.tokens.map((token) => {
      const range = prefixRange(token)
      return sql`EXISTS (
        SELECT 1 FROM session_transcript_terms AS transcript_terms
        WHERE transcript_terms.session_id = archived_items.session_id
          AND transcript_terms.term >= ${range.from} AND transcript_terms.term < ${range.to}
      )`
    }),
  ])
}

function termScore(sql: SqlClient.SqlClient, term: ArchivedSearchTerm) {
  const escaped = likeEscape(term.text)
  return sql`CASE
    WHEN lower(archived_items.title) LIKE ${`${escaped}%`} ESCAPE '\\'
      THEN ${ARCHIVED_MATCH_SCORE.titleStart}
    WHEN lower(archived_items.title) LIKE ${`% ${escaped}%`} ESCAPE '\\'
      THEN ${ARCHIVED_MATCH_SCORE.titleWordStart}
    WHEN ${contains(sql, 'archived_items.title', term.text)} THEN ${ARCHIVED_MATCH_SCORE.title}
    WHEN ${metadataMatch(sql, term)} THEN ${ARCHIVED_MATCH_SCORE.context}
    ELSE ${ARCHIVED_MATCH_SCORE.transcript}
  END`
}

/**
 * Archived sessions, and the archived branches of sessions that are not archived themselves
 * (an archived session's branches come back with it), as one row shape.
 */
function archivedItemsCte(sql: SqlClient.SqlClient) {
  return sql`archived_items AS MATERIALIZED (
    SELECT 'session' AS kind, sessions.id AS session_id, NULL AS branch_id,
      sessions.title AS title, NULL AS parent_title, sessions.project_path AS project_path,
      COALESCE(sessions.archived_at, sessions.updated_at) AS archived_at
    FROM sessions INDEXED BY idx_sessions_archived_at
    WHERE sessions.archived = 1
    UNION ALL
    SELECT 'branch', session_branches.session_id, session_branches.id,
      session_branches.name, sessions.title, sessions.project_path, session_branches.archived_at
    FROM session_branches INDEXED BY idx_session_branches_archived_at
    JOIN sessions ON sessions.id = session_branches.session_id
    WHERE session_branches.archived_at IS NOT NULL AND sessions.archived = 0
  )`
}

/** The archived items that match every search term, scored, before any facet applies. */
export function matchedArchivedItemsCtes(
  sql: SqlClient.SqlClient,
  terms: readonly ArchivedSearchTerm[],
) {
  const matches = terms.map(
    (term) => sql`(${metadataMatch(sql, term)} OR ${transcriptMatch(sql, term)})`,
  )
  const score =
    terms.length === 0
      ? sql.literal('0')
      : sql.join(' + ', true, '0')(terms.map((term) => termScore(sql, term)))
  return sql`${archivedItemsCte(sql)}, matched AS MATERIALIZED (
    SELECT archived_items.*, ${score} AS score
    FROM archived_items
    WHERE ${sql.and(matches)}
  )`
}

export function projectCondition(
  sql: SqlClient.SqlClient,
  project: ArchivedItemsFilter['project'],
) {
  if (!project) return sql.literal('1')
  return project.projectPath === null
    ? sql.literal('matched.project_path IS NULL')
    : sql`matched.project_path = ${project.projectPath}`
}

export function withinCondition(
  sql: SqlClient.SqlClient,
  within: ArchivedWithinFilter | undefined,
  bounds: ArchivedWithinBounds,
) {
  if (within === undefined || within === 'any') return sql.literal('1')
  if (within === 'older') return sql`matched.archived_at < ${bounds.month}`
  return sql`matched.archived_at >= ${bounds[within]}`
}

export function kindCondition(sql: SqlClient.SqlClient, kind: ArchivedItemsFilter['kind']) {
  return kind === undefined || kind === 'all' ? sql.literal('1') : sql`matched.kind = ${kind}`
}

export function archivedItemsOrder(
  sql: SqlClient.SqlClient,
  sort: ArchivedItemsSort | undefined,
  hasTerms: boolean,
) {
  const stable = 'matched.kind, matched.session_id, matched.branch_id'
  if (sort === 'oldest') return sql.literal(`matched.archived_at ASC, ${stable}`)
  if (sort === 'recent' || !hasTerms) return sql.literal(`matched.archived_at DESC, ${stable}`)
  return sql.literal(`matched.score DESC, matched.archived_at DESC, ${stable}`)
}

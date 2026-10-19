import type * as SqlClient from '@effect/sql/SqlClient'
import * as Effect from 'effect/Effect'
import {
  type ArchivedSearchTerm,
  archivedItemKey,
  archivedItemsCte,
  foldSearchText,
} from './archived-items-sql'

/** Relevance per search term, best first: where in the item's own text the term was found. */
const ARCHIVED_METADATA_SCORE = {
  titleStart: 100,
  titleWordStart: 80,
  title: 60,
  context: 40,
} as const

const WORD_BOUNDARY = /[\s\-_/:.]/u

interface ArchivedMetadataRow {
  readonly kind: string
  readonly session_id: string
  readonly branch_id: string | null
  readonly title: string
  readonly parent_title: string | null
  readonly project_path: string | null
}

type ArchivedMetadataText = Pick<ArchivedMetadataRow, 'title' | 'parent_title' | 'project_path'>

/** An item's own text, folded once for all the terms. */
interface FoldedMetadata {
  readonly title: string
  readonly context: readonly string[]
}

function foldMetadata(row: ArchivedMetadataText): FoldedMetadata {
  return {
    title: foldSearchText(row.title),
    context: [foldSearchText(row.parent_title), foldSearchText(row.project_path)],
  }
}

function titleScore(title: string, text: string) {
  const index = title.indexOf(text)
  if (index === -1) return 0
  if (index === 0) return ARCHIVED_METADATA_SCORE.titleStart
  let from = index
  while (from !== -1) {
    if (WORD_BOUNDARY.test(title.charAt(from - 1))) return ARCHIVED_METADATA_SCORE.titleWordStart
    from = title.indexOf(text, from + 1)
  }
  return ARCHIVED_METADATA_SCORE.title
}

/** How well one term matches the item's title, parent title, or project; 0 when it does not. */
function metadataScore(metadata: FoldedMetadata, term: ArchivedSearchTerm) {
  const title = titleScore(metadata.title, term.folded)
  if (title > 0) return title
  return metadata.context.some((value) => value.includes(term.folded))
    ? ARCHIVED_METADATA_SCORE.context
    : 0
}

/** Whether the term matched what the row shows anyway: its title, parent title, or project. */
export function shownInRow(row: ArchivedMetadataText, term: ArchivedSearchTerm) {
  return metadataScore(foldMetadata(row), term) > 0
}

/**
 * The archived items whose own text matches at least one term, with each term's score, as JSON
 * for `json_each`. The archive is read once, a few short strings per item, so this costs a few
 * milliseconds for thousands of items and keeps the folding exact.
 */
export function loadMetadataHits(sql: SqlClient.SqlClient, terms: readonly ArchivedSearchTerm[]) {
  if (terms.length === 0) return Effect.succeed('[]')
  return sql<ArchivedMetadataRow>`
    WITH ${archivedItemsCte(sql)}
    SELECT kind, session_id, branch_id, title, parent_title, project_path FROM archived_items
  `.pipe(
    Effect.map((rows) =>
      JSON.stringify(
        rows.flatMap((row) => {
          const metadata = foldMetadata(row)
          const scores = terms.map((term) => metadataScore(metadata, term))
          return scores.some((score) => score > 0) ? [{ key: archivedItemKey(row), scores }] : []
        }),
      ),
    ),
  )
}

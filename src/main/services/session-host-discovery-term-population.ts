/** One native vocabulary traversal, grouped before the Session mapping lookup. */
export const SESSION_DISCOVERY_TERM_GROUP_SQL = `
  SELECT doc AS search_rowid, term,
    SUM(col = 'initial_objective') AS initial_frequency,
    SUM(col = 'current_preview') AS preview_frequency,
    SUM(COUNT(*)) OVER (PARTITION BY doc) AS token_count
  FROM session_discovery_term_bulk_vocabulary
  GROUP BY doc, term
`

/**
 * Runs inside the caller's migration/cutover transaction, before incremental triggers exist.
 * Temporary grouped facts let validation reuse the one native FTS traversal. They store neither
 * scores nor corpus statistics and are dropped before the catalog becomes available to readers.
 */
export const SESSION_DISCOVERY_TERM_POPULATION_STATEMENTS = [
  `CREATE VIRTUAL TABLE temp.session_discovery_term_bulk_vocabulary
    USING fts5vocab(main, session_node_discovery_search, 'instance')`,
  `CREATE TEMP TABLE session_discovery_term_bulk AS ${SESSION_DISCOVERY_TERM_GROUP_SQL}`,
  `INSERT INTO session_discovery_term_postings (
    session_id, term, search_rowid, initial_frequency, preview_frequency, token_count
  )
  SELECT mapping.session_id, terms.term, terms.search_rowid,
    terms.initial_frequency, terms.preview_frequency, terms.token_count
  FROM session_discovery_term_bulk AS terms
  JOIN session_discovery_search_rows AS mapping ON mapping.search_rowid = terms.search_rowid`,
  `CREATE TEMP TABLE session_discovery_signature_bulk AS
    SELECT term, initial_frequency, preview_frequency, token_count,
      MIN(search_rowid) AS representative_rowid, COUNT(*) AS member_count
    FROM session_discovery_term_postings
    GROUP BY term, initial_frequency, preview_frequency, token_count`,
  `INSERT INTO session_discovery_term_signatures (
    term, initial_frequency, preview_frequency, token_count, representative_rowid, member_count
  ) SELECT term, initial_frequency, preview_frequency, token_count,
    representative_rowid, member_count FROM session_discovery_signature_bulk`,
  `CREATE TEMP TABLE session_discovery_term_validation (
    mapping_valid INTEGER CONSTRAINT discovery_native_mapping CHECK (mapping_valid = 1),
    postings_valid INTEGER CONSTRAINT discovery_native_postings CHECK (postings_valid = 1),
    signatures_valid INTEGER CONSTRAINT discovery_native_signatures CHECK (signatures_valid = 1),
    stage_empty INTEGER CONSTRAINT discovery_native_stage_empty CHECK (stage_empty = 1)
  )`,
  `INSERT INTO session_discovery_term_validation
  SELECT
    (SELECT COUNT(*) FROM session_node_discovery_search) =
      (SELECT COUNT(*) FROM session_discovery_search_rows)
    AND NOT EXISTS (
      SELECT 1 FROM session_discovery_search_rows AS mapping
      LEFT JOIN session_node_discovery_search AS native ON native.rowid = mapping.search_rowid
      WHERE native.rowid IS NULL OR native.session_id IS NOT mapping.session_id
        OR native.initial_objective IS NOT mapping.initial_objective
        OR native.current_preview IS NOT mapping.current_preview
    ),
    (SELECT COUNT(*) FROM session_discovery_term_bulk) =
      (SELECT COUNT(*) FROM session_discovery_term_postings)
    AND NOT EXISTS (
      SELECT 1 FROM session_discovery_term_bulk AS terms
      LEFT JOIN session_discovery_search_rows AS mapping
        ON mapping.search_rowid = terms.search_rowid
      LEFT JOIN session_discovery_term_postings AS postings
        ON postings.session_id = mapping.session_id AND postings.term = terms.term
      WHERE postings.session_id IS NULL OR postings.search_rowid <> terms.search_rowid
        OR postings.initial_frequency <> terms.initial_frequency
        OR postings.preview_frequency <> terms.preview_frequency
        OR postings.token_count <> terms.token_count
    ),
    (SELECT COUNT(*) FROM session_discovery_signature_bulk) =
      (SELECT COUNT(*) FROM session_discovery_term_signatures)
    AND NOT EXISTS (
      SELECT 1 FROM session_discovery_signature_bulk AS expected
      LEFT JOIN session_discovery_term_signatures AS actual
        ON actual.term = expected.term
          AND actual.initial_frequency = expected.initial_frequency
          AND actual.preview_frequency = expected.preview_frequency
          AND actual.token_count = expected.token_count
      WHERE actual.term IS NULL OR actual.representative_rowid <> expected.representative_rowid
        OR actual.member_count <> expected.member_count
    ),
    NOT EXISTS (SELECT 1 FROM session_discovery_term_stage)`,
  'DROP TABLE temp.session_discovery_term_validation',
  'DROP TABLE temp.session_discovery_signature_bulk',
  'DROP TABLE temp.session_discovery_term_bulk',
  'DROP TABLE temp.session_discovery_term_bulk_vocabulary',
] as const

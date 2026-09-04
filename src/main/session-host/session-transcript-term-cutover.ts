import type { DatabaseSync } from 'node:sqlite'
import { queryCutoverRecord } from './session-host-cutover-database'

const CUTOVER_VOCABULARY_TABLE = 'session_node_search_cutover_vocabulary'
const CUTOVER_TERM_GROUPS_TABLE = 'session_transcript_cutover_term_groups'

function validatePopulatedCatalog(database: DatabaseSync) {
  const documentMismatch = queryCutoverRecord(
    database,
    `WITH expected AS (
      SELECT session_id, SUM(occurrences) AS token_count
      FROM temp.${CUTOVER_TERM_GROUPS_TABLE}
      GROUP BY session_id
    )
    SELECT 1 AS mismatch
    FROM sessions
    JOIN session_transcript_term_documents AS documents
      ON documents.session_id = sessions.id
    LEFT JOIN expected ON expected.session_id = sessions.id
    WHERE documents.token_count <> COALESCE(expected.token_count, 0)
    LIMIT 1`,
  )?.mismatch
  if (documentMismatch === 1) {
    throw new Error('Session Host transcript document counts do not match the FTS vocabulary.')
  }
  const termMismatch = queryCutoverRecord(
    database,
    `WITH expected AS (
      SELECT groups.term, groups.session_id, groups.occurrences,
        nodes.id AS first_node_id, nodes.created_order AS first_created_order,
        json_extract(nodes.metadata_json, '$.openWaggle.runId') AS first_run_id,
        CAST(groups.occurrences AS REAL) / documents.token_count AS term_frequency
      FROM temp.${CUTOVER_TERM_GROUPS_TABLE} AS groups
      JOIN session_nodes AS nodes ON nodes.id = substr(groups.evidence_key, 22)
      JOIN session_transcript_term_documents AS documents
        ON documents.session_id = groups.session_id
    )
    SELECT 1 AS mismatch
    FROM expected
    LEFT JOIN session_transcript_terms AS terms
      ON terms.term = expected.term AND terms.session_id = expected.session_id
    WHERE terms.term IS NULL
      OR terms.occurrences <> expected.occurrences
      OR terms.first_node_id <> expected.first_node_id
      OR terms.first_created_order <> expected.first_created_order
      OR terms.first_run_id IS NOT expected.first_run_id
      OR abs(terms.term_frequency - expected.term_frequency) > 0.000000001
    UNION ALL
    SELECT 1
    FROM session_transcript_terms AS terms
    LEFT JOIN temp.${CUTOVER_TERM_GROUPS_TABLE} AS groups
      ON groups.term = terms.term AND groups.session_id = terms.session_id
    WHERE groups.term IS NULL
    LIMIT 1`,
  )?.mismatch
  if (termMismatch === 1) {
    throw new Error('Session Host transcript terms do not match the FTS vocabulary.')
  }
}

/** Builds the complete term catalog with SQLite's own unicode61 tokenizer in set-based SQL. */
export function populateSessionTranscriptTermCatalog(database: DatabaseSync) {
  database.exec(`DROP TABLE IF EXISTS temp.${CUTOVER_TERM_GROUPS_TABLE}`)
  database.exec(`DROP TABLE IF EXISTS temp.${CUTOVER_VOCABULARY_TABLE}`)
  database.exec(`CREATE VIRTUAL TABLE temp.${CUTOVER_VOCABULARY_TABLE}
    USING fts5vocab(main, session_node_search, 'instance')`)
  try {
    database.exec(`
      CREATE TABLE temp.${CUTOVER_TERM_GROUPS_TABLE} (
        term TEXT NOT NULL,
        session_id TEXT NOT NULL,
        occurrences INTEGER NOT NULL,
        evidence_key TEXT NOT NULL,
        PRIMARY KEY (term, session_id)
      ) WITHOUT ROWID;

      INSERT INTO temp.${CUTOVER_TERM_GROUPS_TABLE} (
        term, session_id, occurrences, evidence_key
      )
      SELECT vocabulary.term, search.session_id, COUNT(*) AS occurrences,
        MIN(printf('%020d:%s', nodes.created_order, search.node_id)) AS evidence_key
      FROM temp.${CUTOVER_VOCABULARY_TABLE} AS vocabulary
      JOIN session_node_search AS search ON search.rowid = vocabulary.doc
      JOIN session_nodes AS nodes ON nodes.id = search.node_id
      GROUP BY vocabulary.term, search.session_id;

      INSERT INTO session_transcript_term_documents (session_id, token_count)
      SELECT sessions.id, COALESCE(token_counts.token_count, 0)
      FROM sessions
      LEFT JOIN (
        SELECT session_id, SUM(occurrences) AS token_count
        FROM temp.${CUTOVER_TERM_GROUPS_TABLE}
        GROUP BY session_id
      ) AS token_counts ON token_counts.session_id = sessions.id;

      INSERT INTO session_transcript_terms (
        term, session_id, occurrences, first_node_id, first_created_order, first_run_id,
        term_frequency
      )
      SELECT groups.term, groups.session_id, groups.occurrences,
        nodes.id, nodes.created_order,
        json_extract(nodes.metadata_json, '$.openWaggle.runId'),
        CAST(groups.occurrences AS REAL) / documents.token_count
      FROM temp.${CUTOVER_TERM_GROUPS_TABLE} AS groups
      JOIN session_nodes AS nodes ON nodes.id = substr(groups.evidence_key, 22)
      JOIN session_transcript_term_documents AS documents
        ON documents.session_id = groups.session_id;
    `)
    validatePopulatedCatalog(database)
  } finally {
    database.exec(`DROP TABLE IF EXISTS temp.${CUTOVER_TERM_GROUPS_TABLE}`)
    database.exec(`DROP TABLE IF EXISTS temp.${CUTOVER_VOCABULARY_TABLE}`)
  }
}

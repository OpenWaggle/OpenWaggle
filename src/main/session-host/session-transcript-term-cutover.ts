import type { DatabaseSync } from 'node:sqlite'

const CUTOVER_VOCABULARY_TABLE = 'session_node_search_cutover_vocabulary'

/** Builds the complete term catalog with SQLite's own unicode61 tokenizer in set-based SQL. */
export function populateSessionTranscriptTermCatalog(database: DatabaseSync) {
  database.exec(`
    CREATE VIRTUAL TABLE temp.${CUTOVER_VOCABULARY_TABLE}
    USING fts5vocab(main, session_node_search, 'instance');

    INSERT INTO session_transcript_term_documents (session_id, token_count)
    SELECT sessions.id, COALESCE(token_counts.token_count, 0)
    FROM sessions
    LEFT JOIN (
      SELECT search.session_id, COUNT(*) AS token_count
      FROM temp.${CUTOVER_VOCABULARY_TABLE} AS vocabulary
      JOIN session_node_search AS search ON search.rowid = vocabulary.doc
      GROUP BY search.session_id
    ) AS token_counts ON token_counts.session_id = sessions.id;

    WITH term_groups AS (
      SELECT vocabulary.term, search.session_id, COUNT(*) AS occurrences,
        MIN(printf('%020d:%s', nodes.created_order, search.node_id)) AS evidence_key
      FROM temp.${CUTOVER_VOCABULARY_TABLE} AS vocabulary
      JOIN session_node_search AS search ON search.rowid = vocabulary.doc
      JOIN session_nodes AS nodes ON nodes.id = search.node_id
      GROUP BY vocabulary.term, search.session_id
    )
    INSERT INTO session_transcript_terms (
      term, session_id, occurrences, first_node_id, first_created_order, first_run_id,
      term_frequency
    )
    SELECT term_groups.term, term_groups.session_id, term_groups.occurrences,
      nodes.id, nodes.created_order,
      json_extract(nodes.metadata_json, '$.openWaggle.runId'),
      CAST(term_groups.occurrences AS REAL) / documents.token_count
    FROM term_groups
    JOIN session_nodes AS nodes ON nodes.id = substr(term_groups.evidence_key, 22)
    JOIN session_transcript_term_documents AS documents
      ON documents.session_id = term_groups.session_id;

    DROP TABLE temp.${CUTOVER_VOCABULARY_TABLE};
  `)
}

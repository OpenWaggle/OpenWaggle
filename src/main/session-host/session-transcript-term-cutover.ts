import type { DatabaseSync } from 'node:sqlite'
import { sessionTranscriptSearchContentSql } from '../services/session-transcript-search-content-sql'
import { cutoverRecord, queryCutoverRecord } from './session-host-cutover-database'

const CUTOVER_SESSION_BATCH_SIZE = 1_024
const CUTOVER_SESSION_IDS_TABLE = 'session_transcript_cutover_session_ids'
const CUTOVER_SOURCE_TABLE = 'session_transcript_cutover_source'
const CUTOVER_SEARCH_TABLE = 'session_transcript_cutover_search'
const CUTOVER_VOCABULARY_TABLE = 'session_node_search_cutover_vocabulary'
const CUTOVER_TERM_GROUPS_TABLE = 'session_transcript_cutover_term_groups'
const CUTOVER_TRANSCRIPT_CONTENT = sessionTranscriptSearchContentSql('nodes')
const TRANSCRIPT_TERM_SESSION_INDEX = 'idx_session_transcript_terms_session'
const TRANSCRIPT_TERM_RANK_INDEX = 'idx_session_transcript_terms_rank'

const TRANSCRIPT_TERM_SECONDARY_INDEXES = [
  {
    name: TRANSCRIPT_TERM_SESSION_INDEX,
    sql: `CREATE INDEX ${TRANSCRIPT_TERM_SESSION_INDEX}
      ON session_transcript_terms (session_id, term)`,
  },
  {
    name: TRANSCRIPT_TERM_RANK_INDEX,
    sql: `CREATE INDEX ${TRANSCRIPT_TERM_RANK_INDEX}
      ON session_transcript_terms (term, term_frequency DESC, session_id)`,
  },
] as const

function readSessionBatch(database: DatabaseSync, afterSessionId: string) {
  const values: unknown = database
    .prepare('SELECT id FROM sessions WHERE id > ? ORDER BY id LIMIT ?')
    .all(afterSessionId, CUTOVER_SESSION_BATCH_SIZE)
  if (!Array.isArray(values)) throw new Error('Session transcript cutover batch is invalid.')
  const sessionIds: string[] = []
  for (const value of values) {
    const id = cutoverRecord(value)?.id
    if (typeof id !== 'string') throw new Error('Session transcript cutover Session id is invalid.')
    sessionIds.push(id)
  }
  return sessionIds
}

function prepareBatchTables(database: DatabaseSync) {
  database.exec(`
    CREATE TABLE temp.${CUTOVER_SESSION_IDS_TABLE} (
      session_id TEXT PRIMARY KEY
    ) WITHOUT ROWID;
    CREATE TABLE temp.${CUTOVER_SOURCE_TABLE} (
      session_id TEXT NOT NULL,
      node_id TEXT NOT NULL,
      created_order INTEGER NOT NULL,
      run_id TEXT,
      content TEXT NOT NULL
    );
    CREATE INDEX temp.idx_session_transcript_cutover_source_session
      ON ${CUTOVER_SOURCE_TABLE} (session_id, created_order, node_id);
    CREATE INDEX temp.idx_session_transcript_cutover_source_node
      ON ${CUTOVER_SOURCE_TABLE} (node_id);
    CREATE TABLE temp.${CUTOVER_TERM_GROUPS_TABLE} (
      term TEXT NOT NULL,
      session_id TEXT NOT NULL,
      occurrences INTEGER NOT NULL,
      evidence_key TEXT NOT NULL,
      PRIMARY KEY (term, session_id)
    ) WITHOUT ROWID;
  `)
}

function recreateBatchSearchTables(database: DatabaseSync) {
  database.exec(`
    DROP TABLE IF EXISTS temp.${CUTOVER_VOCABULARY_TABLE};
    DROP TABLE IF EXISTS temp.${CUTOVER_SEARCH_TABLE};
    CREATE VIRTUAL TABLE temp.${CUTOVER_SEARCH_TABLE}
      USING fts5(content, tokenize = 'unicode61 remove_diacritics 2');
    CREATE VIRTUAL TABLE temp.${CUTOVER_VOCABULARY_TABLE}
      USING fts5vocab(${CUTOVER_SEARCH_TABLE}, 'instance');
  `)
}

function clearBatchTables(database: DatabaseSync) {
  recreateBatchSearchTables(database)
  database.exec(`
    DELETE FROM temp.${CUTOVER_SOURCE_TABLE};
    DELETE FROM temp.${CUTOVER_SESSION_IDS_TABLE};
    DELETE FROM temp.${CUTOVER_TERM_GROUPS_TABLE};
  `)
}

function stageBatch(database: DatabaseSync, sessionIds: readonly string[]) {
  const insertSessionId = database.prepare(
    `INSERT INTO temp.${CUTOVER_SESSION_IDS_TABLE} (session_id) VALUES (?)`,
  )
  for (const sessionId of sessionIds) insertSessionId.run(sessionId)
  database.exec(`
    INSERT INTO temp.${CUTOVER_SOURCE_TABLE} (
      session_id, node_id, created_order, run_id, content
    )
    SELECT nodes.session_id, nodes.id, nodes.created_order,
      json_extract(nodes.metadata_json, '$.openWaggle.runId'),
      ${CUTOVER_TRANSCRIPT_CONTENT}
    FROM session_nodes AS nodes
    JOIN temp.${CUTOVER_SESSION_IDS_TABLE} AS requested
      ON requested.session_id = nodes.session_id
    ORDER BY nodes.session_id, nodes.created_order, nodes.id;

    INSERT INTO temp.${CUTOVER_SEARCH_TABLE} (rowid, content)
    SELECT rowid, content FROM temp.${CUTOVER_SOURCE_TABLE};

    INSERT INTO temp.${CUTOVER_TERM_GROUPS_TABLE} (
      term, session_id, occurrences, evidence_key
    )
    SELECT vocabulary.term, source.session_id, COUNT(*) AS occurrences,
      MIN(printf('%020d:%s', source.created_order, source.node_id)) AS evidence_key
    FROM temp.${CUTOVER_VOCABULARY_TABLE} AS vocabulary
    JOIN temp.${CUTOVER_SOURCE_TABLE} AS source ON source.rowid = vocabulary.doc
    GROUP BY vocabulary.term, source.session_id;
  `)
}

function populateBatch(database: DatabaseSync) {
  database.exec(`
    INSERT INTO session_transcript_term_documents (session_id, token_count)
    SELECT requested.session_id, COALESCE(token_counts.token_count, 0)
    FROM temp.${CUTOVER_SESSION_IDS_TABLE} AS requested
    LEFT JOIN (
      SELECT session_id, SUM(occurrences) AS token_count
      FROM temp.${CUTOVER_TERM_GROUPS_TABLE}
      GROUP BY session_id
    ) AS token_counts ON token_counts.session_id = requested.session_id;

    INSERT INTO session_transcript_terms (
      term, session_id, occurrences, first_node_id, first_created_order, first_run_id,
      term_frequency
    )
    SELECT groups.term, groups.session_id, groups.occurrences,
      source.node_id, source.created_order, source.run_id,
      CAST(groups.occurrences AS REAL) / documents.token_count
    FROM temp.${CUTOVER_TERM_GROUPS_TABLE} AS groups
    JOIN temp.${CUTOVER_SOURCE_TABLE} AS source
      ON source.node_id = substr(groups.evidence_key, 22)
    JOIN session_transcript_term_documents AS documents
      ON documents.session_id = groups.session_id;
  `)
}

function validateBatch(database: DatabaseSync) {
  const documentMismatch = queryCutoverRecord(
    database,
    `WITH expected AS (
      SELECT requested.session_id, COALESCE(token_counts.token_count, 0) AS token_count
      FROM temp.${CUTOVER_SESSION_IDS_TABLE} AS requested
      LEFT JOIN (
        SELECT session_id, SUM(occurrences) AS token_count
        FROM temp.${CUTOVER_TERM_GROUPS_TABLE}
        GROUP BY session_id
      ) AS token_counts ON token_counts.session_id = requested.session_id
    )
    SELECT 1 AS mismatch
    FROM expected
    JOIN session_transcript_term_documents AS documents
      ON documents.session_id = expected.session_id
    WHERE documents.token_count <> expected.token_count
    LIMIT 1`,
  )?.mismatch
  if (documentMismatch === 1) {
    throw new Error('Session Host transcript document counts do not match the FTS vocabulary.')
  }
  const termMismatch = queryCutoverRecord(
    database,
    `WITH expected AS (
      SELECT groups.term, groups.session_id, groups.occurrences,
        source.node_id AS first_node_id, source.created_order AS first_created_order,
        source.run_id AS first_run_id,
        CAST(groups.occurrences AS REAL) / documents.token_count AS term_frequency
      FROM temp.${CUTOVER_TERM_GROUPS_TABLE} AS groups
      JOIN temp.${CUTOVER_SOURCE_TABLE} AS source
        ON source.node_id = substr(groups.evidence_key, 22)
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
    LIMIT 1`,
  )?.mismatch
  if (termMismatch === 1) {
    throw new Error('Session Host transcript terms do not match the FTS vocabulary.')
  }
}

function dropBulkLoadIndexes(database: DatabaseSync) {
  const existingNames = new Set<string>()
  for (const index of TRANSCRIPT_TERM_SECONDARY_INDEXES) {
    const exists = queryCutoverRecord(
      database,
      "SELECT 1 AS present FROM sqlite_master WHERE type = 'index' AND name = ?",
      index.name,
    )?.present
    if (exists === 1) {
      existingNames.add(index.name)
      database.exec(`DROP INDEX ${index.name}`)
    }
  }
  return existingNames
}

function restoreBulkLoadIndexes(database: DatabaseSync, names: ReadonlySet<string>) {
  for (const index of TRANSCRIPT_TERM_SECONDARY_INDEXES) {
    if (names.has(index.name)) database.exec(index.sql)
  }
}

function dropBatchTables(database: DatabaseSync) {
  database.exec(`
    DROP TABLE IF EXISTS temp.${CUTOVER_VOCABULARY_TABLE};
    DROP TABLE IF EXISTS temp.${CUTOVER_SEARCH_TABLE};
    DROP TABLE IF EXISTS temp.${CUTOVER_TERM_GROUPS_TABLE};
    DROP TABLE IF EXISTS temp.${CUTOVER_SOURCE_TABLE};
    DROP TABLE IF EXISTS temp.${CUTOVER_SESSION_IDS_TABLE};
  `)
}

/** Builds the exact unicode61 term catalog in bounded Session batches. */
export function populateSessionTranscriptTermCatalog(database: DatabaseSync) {
  dropBatchTables(database)
  const deferredIndexes = dropBulkLoadIndexes(database)
  prepareBatchTables(database)
  try {
    let afterSessionId = ''
    while (true) {
      const sessionIds = readSessionBatch(database, afterSessionId)
      if (sessionIds.length === 0) break
      clearBatchTables(database)
      stageBatch(database, sessionIds)
      populateBatch(database)
      validateBatch(database)
      afterSessionId = sessionIds.at(-1) ?? afterSessionId
    }
  } finally {
    dropBatchTables(database)
    restoreBulkLoadIndexes(database, deferredIndexes)
  }
}

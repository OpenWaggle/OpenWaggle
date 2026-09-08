import type { DatabaseSync } from 'node:sqlite'
import { sessionTranscriptSearchContentSql } from '../services/session-transcript-search-content-sql'
import { queryCutoverRecord } from './session-host-cutover-database'

const CUTOVER_NODE_BATCH_SIZE = 512
const CUTOVER_BATCH_BYTE_LIMIT = 4 * 1_024 * 1_024
const CUTOVER_SESSION_IDS_TABLE = 'session_transcript_cutover_session_ids'
const CUTOVER_SOURCE_TABLE = 'session_transcript_cutover_source'
const CUTOVER_SEARCH_TABLE = 'session_transcript_cutover_search'
const CUTOVER_VOCABULARY_TABLE = 'session_node_search_cutover_vocabulary'
const CUTOVER_TERM_GROUPS_TABLE = 'session_transcript_cutover_term_groups'
const CUTOVER_TRANSCRIPT_CONTENT = sessionTranscriptSearchContentSql('nodes')
const TRANSCRIPT_TERM_SESSION_INDEX = 'idx_session_transcript_terms_session'

const TRANSCRIPT_TERM_SECONDARY_INDEXES = [
  {
    name: TRANSCRIPT_TERM_SESSION_INDEX,
    sql: `CREATE INDEX ${TRANSCRIPT_TERM_SESSION_INDEX}
      ON session_transcript_terms (session_id, term)`,
  },
] as const

interface CutoverCursor {
  readonly sessionId: string
  readonly createdOrder: number
  readonly nodeId: string
}

const INITIAL_CUTOVER_CURSOR: CutoverCursor = {
  sessionId: '',
  createdOrder: -1,
  nodeId: '',
}

function prepareBatchTables(database: DatabaseSync) {
  database.exec(`
    CREATE TABLE temp.${CUTOVER_SESSION_IDS_TABLE} (
      session_id TEXT PRIMARY KEY,
      previous_token_count INTEGER NOT NULL
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
      previous_occurrences INTEGER NOT NULL,
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

function stageBatch(database: DatabaseSync, cursor: CutoverCursor) {
  database
    .prepare(
      `WITH candidates AS MATERIALIZED (
        SELECT nodes.session_id, nodes.id AS node_id, nodes.created_order,
          json_extract(nodes.metadata_json, '$.openWaggle.runId') AS run_id,
          ${CUTOVER_TRANSCRIPT_CONTENT} AS content
        FROM session_nodes AS nodes
        WHERE (nodes.session_id, nodes.created_order, nodes.id) > (?, ?, ?)
        ORDER BY nodes.session_id, nodes.created_order, nodes.id
        LIMIT ?
      ), bounded AS (
        SELECT candidates.*,
          ROW_NUMBER() OVER (
            ORDER BY session_id, created_order, node_id
          ) AS batch_position,
          SUM(length(CAST(content AS BLOB))) OVER (
            ORDER BY session_id, created_order, node_id
            ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
          ) AS cumulative_bytes
        FROM candidates
      )
      INSERT INTO temp.${CUTOVER_SOURCE_TABLE} (
        session_id, node_id, created_order, run_id, content
      )
      SELECT session_id, node_id, created_order, run_id, content
      FROM bounded
      WHERE batch_position = 1 OR cumulative_bytes <= ?
      ORDER BY session_id, created_order, node_id`,
    )
    .run(
      cursor.sessionId,
      cursor.createdOrder,
      cursor.nodeId,
      CUTOVER_NODE_BATCH_SIZE,
      CUTOVER_BATCH_BYTE_LIMIT,
    )
  const last = queryCutoverRecord(
    database,
    `SELECT session_id, created_order, node_id
     FROM temp.${CUTOVER_SOURCE_TABLE}
     ORDER BY session_id DESC, created_order DESC, node_id DESC
     LIMIT 1`,
  )
  if (!last) return null
  if (
    typeof last.session_id !== 'string' ||
    typeof last.created_order !== 'number' ||
    typeof last.node_id !== 'string'
  ) {
    throw new Error('Session transcript cutover node cursor is invalid.')
  }
  database.exec(`
    INSERT INTO temp.${CUTOVER_SESSION_IDS_TABLE} (session_id, previous_token_count)
    SELECT DISTINCT source.session_id, COALESCE(documents.token_count, 0)
    FROM temp.${CUTOVER_SOURCE_TABLE} AS source
    LEFT JOIN session_transcript_term_documents AS documents
      ON documents.session_id = source.session_id;
    INSERT INTO temp.${CUTOVER_SEARCH_TABLE} (rowid, content)
    SELECT rowid, content FROM temp.${CUTOVER_SOURCE_TABLE};

    INSERT INTO temp.${CUTOVER_TERM_GROUPS_TABLE} (
      term, session_id, occurrences, evidence_key, previous_occurrences
    )
    SELECT vocabulary.term, source.session_id, COUNT(*) AS occurrences,
      MIN(printf('%020d:%s', source.created_order, source.node_id)) AS evidence_key,
      COALESCE(MAX(existing.occurrences), 0) AS previous_occurrences
    FROM temp.${CUTOVER_VOCABULARY_TABLE} AS vocabulary
    JOIN temp.${CUTOVER_SOURCE_TABLE} AS source ON source.rowid = vocabulary.doc
    LEFT JOIN session_transcript_terms AS existing
      ON existing.term = vocabulary.term AND existing.session_id = source.session_id
    GROUP BY vocabulary.term, source.session_id;
  `)
  return {
    sessionId: last.session_id,
    createdOrder: last.created_order,
    nodeId: last.node_id,
  }
}

function populateBatch(database: DatabaseSync) {
  database.exec(`
    UPDATE session_transcript_term_documents
    SET token_count = token_count + (
      SELECT COALESCE(SUM(groups.occurrences), 0)
      FROM temp.${CUTOVER_TERM_GROUPS_TABLE} AS groups
      WHERE groups.session_id = session_transcript_term_documents.session_id
    )
    WHERE session_id IN (SELECT session_id FROM temp.${CUTOVER_SESSION_IDS_TABLE});

    INSERT INTO session_transcript_terms (
      term, session_id, occurrences, first_node_id, first_created_order, first_run_id
    )
    SELECT groups.term, groups.session_id, groups.occurrences,
      source.node_id, source.created_order, source.run_id
    FROM temp.${CUTOVER_TERM_GROUPS_TABLE} AS groups
    JOIN temp.${CUTOVER_SOURCE_TABLE} AS source
      ON source.node_id = substr(groups.evidence_key, 22)
    WHERE 1
    ON CONFLICT(term, session_id) DO UPDATE SET
      occurrences = session_transcript_terms.occurrences + excluded.occurrences;
  `)
}

function validateBatch(database: DatabaseSync) {
  const documentMismatch = queryCutoverRecord(
    database,
    `WITH expected AS (
      SELECT requested.session_id,
        requested.previous_token_count + COALESCE(token_counts.token_count, 0) AS token_count
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
      SELECT groups.term, groups.session_id,
        groups.previous_occurrences + groups.occurrences AS occurrences,
        source.node_id AS first_node_id, source.created_order AS first_created_order,
        source.run_id AS first_run_id, groups.previous_occurrences
      FROM temp.${CUTOVER_TERM_GROUPS_TABLE} AS groups
      JOIN temp.${CUTOVER_SOURCE_TABLE} AS source
        ON source.node_id = substr(groups.evidence_key, 22)
    )
    SELECT 1 AS mismatch
    FROM expected
    LEFT JOIN session_transcript_terms AS terms
      ON terms.term = expected.term AND terms.session_id = expected.session_id
    WHERE terms.term IS NULL
      OR terms.occurrences <> expected.occurrences
      OR (expected.previous_occurrences = 0 AND (
        terms.first_node_id <> expected.first_node_id
        OR terms.first_created_order <> expected.first_created_order
        OR terms.first_run_id IS NOT expected.first_run_id
      ))
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

/** Builds the exact unicode61 term catalog in bounded node and content-byte batches. */
export function populateSessionTranscriptTermCatalog(database: DatabaseSync) {
  dropBatchTables(database)
  const deferredIndexes = dropBulkLoadIndexes(database)
  prepareBatchTables(database)
  try {
    database.exec(`
      INSERT INTO session_transcript_term_documents (session_id, token_count)
      SELECT id, 0 FROM sessions
    `)
    let cursor = INITIAL_CUTOVER_CURSOR
    while (true) {
      clearBatchTables(database)
      const nextCursor = stageBatch(database, cursor)
      if (!nextCursor) break
      populateBatch(database)
      validateBatch(database)
      cursor = nextCursor
    }
  } finally {
    dropBatchTables(database)
    restoreBulkLoadIndexes(database, deferredIndexes)
  }
}

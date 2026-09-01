import {
  refreshSessionLexicalDiscoverySql,
  SESSION_DISCOVERY_SEARCH_ROW_SCHEMA_STATEMENTS,
} from './session-host-discovery-search-schema'
import { SESSION_NODE_SEARCH_ROW_SCHEMA_STATEMENTS } from './session-host-node-search-row-schema'
import {
  NEW_NODE_IS_TRANSCRIPT_ELIGIBLE,
  recentTranscriptNodeIds,
  refreshTranscriptScopeCoverageSql,
  SESSION_TRANSCRIPT_SEMANTIC_SCHEMA_STATEMENTS,
  TRANSCRIPT_STORAGE_HAS_CAPACITY,
} from './session-host-transcript-semantic-schema'
import { SESSION_TRANSCRIPT_TERM_SCHEMA_STATEMENTS } from './session-host-transcript-term-schema'
import { sessionTranscriptSearchContentSql } from './session-transcript-search-content-sql'

const NEW_TRANSCRIPT_SEARCH_CONTENT = sessionTranscriptSearchContentSql('new')

export const SESSION_SEARCH_TARGET_SCHEMA_STATEMENTS = [
  `
  CREATE INDEX idx_sessions_project_path
  ON sessions (project_path)
  `,
  `
  CREATE TABLE session_semantic_discovery_state (
    singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
    status TEXT NOT NULL CHECK (status IN ('preparing', 'ready', 'failed')),
    model_id TEXT NOT NULL,
    model_revision TEXT NOT NULL,
    dimensions INTEGER NOT NULL CHECK (dimensions > 0),
    snapshot_revision INTEGER NOT NULL DEFAULT 0,
    prepared_count INTEGER NOT NULL DEFAULT 0,
    pending_count INTEGER NOT NULL DEFAULT 0,
    preparation_operation_id TEXT,
    failure_message TEXT,
    updated_at INTEGER NOT NULL
  )
  `,
  `
  CREATE TABLE session_discovery_embeddings (
    session_id TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
    model_id TEXT NOT NULL,
    model_revision TEXT NOT NULL,
    dimensions INTEGER NOT NULL CHECK (dimensions > 0),
    source_hash TEXT NOT NULL,
    vector BLOB NOT NULL,
    snapshot_revision INTEGER NOT NULL CHECK (snapshot_revision > 0),
    updated_at INTEGER NOT NULL
  )
  `,
  `
  CREATE INDEX idx_session_discovery_embeddings_snapshot
  ON session_discovery_embeddings (model_revision, snapshot_revision, session_id)
  `,
  `
  CREATE TABLE session_discovery_embedding_deletions (
    session_id TEXT PRIMARY KEY,
    snapshot_revision INTEGER NOT NULL CHECK (snapshot_revision > 0)
  )
  `,
  `
  CREATE INDEX idx_session_discovery_embedding_deletions_snapshot
  ON session_discovery_embedding_deletions (snapshot_revision, session_id)
  `,
  `
  CREATE TABLE session_discovery_embedding_queue (
    session_id TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
    queued_at INTEGER NOT NULL
  )
  `,
  `
  CREATE INDEX idx_session_discovery_embedding_queue_order
  ON session_discovery_embedding_queue (queued_at, session_id)
  `,
  ...SESSION_TRANSCRIPT_SEMANTIC_SCHEMA_STATEMENTS,
  `
  CREATE VIRTUAL TABLE session_title_search USING fts5(
    session_id UNINDEXED,
    title,
    tokenize = 'unicode61 remove_diacritics 2'
  )
  `,
  `
  CREATE VIRTUAL TABLE session_node_search USING fts5(
    session_id UNINDEXED,
    node_id UNINDEXED,
    content,
    tokenize = 'unicode61 remove_diacritics 2'
  )
  `,
  ...SESSION_NODE_SEARCH_ROW_SCHEMA_STATEMENTS,
  ...SESSION_TRANSCRIPT_TERM_SCHEMA_STATEMENTS,
  `
  CREATE VIRTUAL TABLE session_node_discovery_search USING fts5(
    session_id UNINDEXED,
    initial_objective,
    current_preview,
    tokenize = 'unicode61 remove_diacritics 2'
  )
  `,
  ...SESSION_DISCOVERY_SEARCH_ROW_SCHEMA_STATEMENTS,
  `
  CREATE VIRTUAL TABLE session_delegation_search USING fts5(
    session_id UNINDEXED,
    delegation_id UNINDEXED,
    objective,
    tokenize = 'unicode61 remove_diacritics 2'
  )
  `,
  `
  CREATE TRIGGER session_title_search_insert AFTER INSERT ON sessions BEGIN
    INSERT INTO session_title_search (session_id, title) VALUES (new.id, new.title);
    INSERT INTO session_node_discovery_search (
      session_id, initial_objective, current_preview
    ) VALUES (new.id, '', '');
    INSERT INTO session_discovery_search_rows (session_id, search_rowid)
    VALUES (new.id, last_insert_rowid());
    INSERT INTO session_discovery_embedding_queue (session_id, queued_at)
    VALUES (new.id, unixepoch('subsec') * 1000)
    ON CONFLICT(session_id) DO UPDATE SET queued_at = excluded.queued_at;
  END
  `,
  `
  CREATE TRIGGER session_title_search_update AFTER UPDATE OF title ON sessions BEGIN
    DELETE FROM session_title_search WHERE session_id = old.id;
    INSERT INTO session_title_search (session_id, title) VALUES (new.id, new.title);
    INSERT INTO session_discovery_embedding_queue (session_id, queued_at)
    VALUES (new.id, unixepoch('subsec') * 1000)
    ON CONFLICT(session_id) DO UPDATE SET queued_at = excluded.queued_at;
  END
  `,
  `
  CREATE TRIGGER session_title_search_delete AFTER DELETE ON sessions BEGIN
    DELETE FROM session_title_search WHERE session_id = old.id;
    UPDATE session_semantic_discovery_state
    SET snapshot_revision = snapshot_revision + 1,
      prepared_count = (SELECT COUNT(*) FROM session_discovery_embeddings),
      pending_count = (SELECT COUNT(*) FROM session_discovery_embedding_queue),
      updated_at = unixepoch('subsec') * 1000
    WHERE singleton = 1;
    INSERT INTO session_discovery_embedding_deletions (session_id, snapshot_revision)
    SELECT old.id, snapshot_revision
    FROM session_semantic_discovery_state
    WHERE singleton = 1
    ON CONFLICT(session_id) DO UPDATE SET
      snapshot_revision = excluded.snapshot_revision;
  END
  `,
  `
  CREATE TRIGGER session_node_search_insert AFTER INSERT ON session_nodes BEGIN
    INSERT INTO session_node_search (session_id, node_id, content)
    VALUES (new.session_id, new.id, ${NEW_TRANSCRIPT_SEARCH_CONTENT});
    INSERT INTO session_node_search_rows (node_id, session_id, search_rowid)
    VALUES (new.id, new.session_id, last_insert_rowid());
    ${refreshSessionLexicalDiscoverySql('new.session_id')}
    INSERT INTO session_discovery_embedding_queue (session_id, queued_at)
    VALUES (new.session_id, unixepoch('subsec') * 1000)
    ON CONFLICT(session_id) DO UPDATE SET queued_at = excluded.queued_at;
    DELETE FROM session_transcript_embedding_queue
    WHERE session_id = new.session_id
      AND node_id NOT IN (${recentTranscriptNodeIds('new.session_id')});
    DELETE FROM session_transcript_embeddings
    WHERE session_id = new.session_id
      AND node_id NOT IN (${recentTranscriptNodeIds('new.session_id')});
    INSERT INTO session_transcript_embedding_queue (node_id, session_id, queued_at)
    SELECT new.id, new.session_id, unixepoch('subsec') * 1000
    FROM session_transcript_semantic_scopes AS scopes
    WHERE scopes.session_id = new.session_id
      AND trim(${NEW_TRANSCRIPT_SEARCH_CONTENT}) <> ''
      AND ${NEW_NODE_IS_TRANSCRIPT_ELIGIBLE}
      AND ${TRANSCRIPT_STORAGE_HAS_CAPACITY}
    ON CONFLICT(node_id) DO UPDATE SET queued_at = excluded.queued_at;
    ${refreshTranscriptScopeCoverageSql('new.session_id')}
  END
  `,
  `
  CREATE TRIGGER session_node_search_update
  AFTER UPDATE OF content_json, role, created_order ON session_nodes BEGIN
    DELETE FROM session_node_search
    WHERE rowid = (SELECT search_rowid FROM session_node_search_rows WHERE node_id = old.id);
    DELETE FROM session_node_search_rows WHERE node_id = old.id;
    DELETE FROM session_transcript_embedding_queue WHERE node_id = old.id;
    DELETE FROM session_transcript_embeddings WHERE node_id = old.id;
    INSERT INTO session_node_search (session_id, node_id, content)
    VALUES (new.session_id, new.id, ${NEW_TRANSCRIPT_SEARCH_CONTENT});
    INSERT INTO session_node_search_rows (node_id, session_id, search_rowid)
    VALUES (new.id, new.session_id, last_insert_rowid());
    ${refreshSessionLexicalDiscoverySql('new.session_id')}
    INSERT INTO session_discovery_embedding_queue (session_id, queued_at)
    VALUES (new.session_id, unixepoch('subsec') * 1000)
    ON CONFLICT(session_id) DO UPDATE SET queued_at = excluded.queued_at;
    DELETE FROM session_transcript_embedding_queue
    WHERE session_id = new.session_id
      AND node_id NOT IN (${recentTranscriptNodeIds('new.session_id')});
    DELETE FROM session_transcript_embeddings
    WHERE session_id = new.session_id
      AND node_id NOT IN (${recentTranscriptNodeIds('new.session_id')});
    INSERT INTO session_transcript_embedding_queue (node_id, session_id, queued_at)
    SELECT new.id, new.session_id, unixepoch('subsec') * 1000
    FROM session_transcript_semantic_scopes AS scopes
    WHERE scopes.session_id = new.session_id
      AND trim(${NEW_TRANSCRIPT_SEARCH_CONTENT}) <> ''
      AND ${NEW_NODE_IS_TRANSCRIPT_ELIGIBLE}
      AND ${TRANSCRIPT_STORAGE_HAS_CAPACITY}
    ON CONFLICT(node_id) DO UPDATE SET queued_at = excluded.queued_at;
    ${refreshTranscriptScopeCoverageSql('new.session_id')}
  END
  `,
  `
  CREATE TRIGGER session_node_search_delete BEFORE DELETE ON session_nodes BEGIN
    DELETE FROM session_node_search
    WHERE rowid = (SELECT search_rowid FROM session_node_search_rows WHERE node_id = old.id);
    DELETE FROM session_node_search_rows WHERE node_id = old.id;
    DELETE FROM session_transcript_embedding_queue WHERE node_id = old.id;
    DELETE FROM session_transcript_embeddings WHERE node_id = old.id;
    INSERT INTO session_discovery_embedding_queue (session_id, queued_at)
    VALUES (old.session_id, unixepoch('subsec') * 1000)
    ON CONFLICT(session_id) DO UPDATE SET queued_at = excluded.queued_at;
    ${refreshTranscriptScopeCoverageSql('old.session_id')}
  END
  `,
  `
  CREATE TRIGGER session_node_discovery_search_delete AFTER DELETE ON session_nodes BEGIN
    ${refreshSessionLexicalDiscoverySql('old.session_id')}
  END
  `,
  `
  CREATE TRIGGER session_delegation_search_insert AFTER INSERT ON delegation_specifications BEGIN
    INSERT INTO session_delegation_search (session_id, delegation_id, objective)
    SELECT contracts.child_session_id, new.delegation_id,
      COALESCE(json_extract(new.specification_json, '$.objective'), '')
    FROM delegation_contracts AS contracts
    WHERE contracts.id = new.delegation_id;
    INSERT INTO session_discovery_embedding_queue (session_id, queued_at)
    SELECT contracts.child_session_id, unixepoch('subsec') * 1000
    FROM delegation_contracts AS contracts WHERE contracts.id = new.delegation_id
    ON CONFLICT(session_id) DO UPDATE SET queued_at = excluded.queued_at;
  END
  `,
  `
  CREATE TRIGGER session_delegation_search_delete AFTER DELETE ON delegation_specifications BEGIN
    DELETE FROM session_delegation_search WHERE delegation_id = old.delegation_id;
    INSERT INTO session_discovery_embedding_queue (session_id, queued_at)
    SELECT contracts.child_session_id, unixepoch('subsec') * 1000
    FROM delegation_contracts AS contracts WHERE contracts.id = old.delegation_id
    ON CONFLICT(session_id) DO UPDATE SET queued_at = excluded.queued_at;
  END
  `,
  `
  INSERT INTO session_discovery_embedding_queue (session_id, queued_at)
  SELECT id, unixepoch('subsec') * 1000 FROM sessions WHERE true
  ON CONFLICT(session_id) DO NOTHING
  `,
] as const

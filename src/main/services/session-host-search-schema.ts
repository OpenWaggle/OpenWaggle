import {
  NEW_NODE_IS_TRANSCRIPT_ELIGIBLE,
  recentTranscriptNodeIds,
  refreshTranscriptScopeCoverageSql,
  SESSION_TRANSCRIPT_SEMANTIC_SCHEMA_STATEMENTS,
  TRANSCRIPT_STORAGE_HAS_CAPACITY,
} from './session-host-transcript-semantic-schema'

const SEARCHABLE_CUSTOM_MESSAGE_TYPES_SQL =
  "'openwaggle-delegation-specification-update', 'openwaggle-orchestration-update', 'openwaggle-peer-agent-report'"

/** SQLite equivalent of the node-aware transcript document projection. */
export function sessionTranscriptSearchContentSql(source: string) {
  return `substr(CASE
    WHEN ${source}.role IN ('user', 'assistant') OR ${source}.kind = 'tool_result' THEN COALESCE(
      (SELECT GROUP_CONCAT(
        CASE json_extract(part.value, '$.type')
          WHEN 'text' THEN json_extract(part.value, '$.text')
          WHEN 'attachment' THEN json_extract(part.value, '$.attachment.name')
          WHEN 'tool-call' THEN json_extract(part.value, '$.toolCall.name')
          WHEN 'tool-result' THEN trim(
            COALESCE(json_extract(part.value, '$.toolResult.name'), '') || ' ' ||
            CASE json_extract(part.value, '$.toolResult.isError')
              WHEN 1 THEN 'failed' ELSE 'completed'
            END
          )
          ELSE NULL
        END,
        ' '
      ) FROM json_each(${source}.content_json, '$.parts') AS part),
      json_extract(${source}.content_json, '$.text'),
      ''
    )
    WHEN ${source}.kind IN ('branch_summary', 'compaction_summary')
      THEN COALESCE(json_extract(${source}.content_json, '$.summary'), '')
    WHEN ${source}.kind = 'custom'
      AND json_extract(${source}.content_json, '$.display') = 1
      AND json_extract(${source}.content_json, '$.customType') IN (
        ${SEARCHABLE_CUSTOM_MESSAGE_TYPES_SQL}
      )
      THEN COALESCE(json_extract(${source}.content_json, '$.content'), '')
    ELSE ''
  END, 1, 12000)`
}

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
  CREATE TABLE session_discovery_embedding_queue (
    session_id TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
    queued_at INTEGER NOT NULL
  )
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
  `
  CREATE VIRTUAL TABLE session_node_discovery_search USING fts5(
    session_id UNINDEXED,
    node_id UNINDEXED,
    content,
    tokenize = 'unicode61 remove_diacritics 2'
  )
  `,
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
  END
  `,
  `
  CREATE TRIGGER session_node_search_insert AFTER INSERT ON session_nodes BEGIN
    INSERT INTO session_node_search (session_id, node_id, content)
    VALUES (new.session_id, new.id, ${NEW_TRANSCRIPT_SEARCH_CONTENT});
    INSERT INTO session_node_discovery_search (session_id, node_id, content)
    VALUES (new.session_id, new.id, COALESCE(
      (SELECT GROUP_CONCAT(
        CASE json_extract(part.value, '$.type')
          WHEN 'text' THEN json_extract(part.value, '$.text')
          WHEN 'attachment' THEN json_extract(part.value, '$.attachment.name')
          WHEN 'tool-call' THEN json_extract(part.value, '$.toolCall.name')
          WHEN 'tool-result' THEN json_extract(part.value, '$.toolResult.name')
          ELSE NULL
        END,
        ' '
      ) FROM json_each(new.content_json, '$.parts') AS part),
      json_extract(new.content_json, '$.text'),
      ''
    ));
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
  CREATE TRIGGER session_node_search_update AFTER UPDATE OF content_json ON session_nodes BEGIN
    DELETE FROM session_node_search WHERE node_id = old.id;
    DELETE FROM session_node_discovery_search WHERE node_id = old.id;
    DELETE FROM session_transcript_embedding_queue WHERE node_id = old.id;
    DELETE FROM session_transcript_embeddings WHERE node_id = old.id;
    INSERT INTO session_node_search (session_id, node_id, content)
    VALUES (new.session_id, new.id, ${NEW_TRANSCRIPT_SEARCH_CONTENT});
    INSERT INTO session_node_discovery_search (session_id, node_id, content)
    VALUES (new.session_id, new.id, COALESCE(
      (SELECT GROUP_CONCAT(
        CASE json_extract(part.value, '$.type')
          WHEN 'text' THEN json_extract(part.value, '$.text')
          WHEN 'attachment' THEN json_extract(part.value, '$.attachment.name')
          WHEN 'tool-call' THEN json_extract(part.value, '$.toolCall.name')
          WHEN 'tool-result' THEN json_extract(part.value, '$.toolResult.name')
          ELSE NULL
        END,
        ' '
      ) FROM json_each(new.content_json, '$.parts') AS part),
      json_extract(new.content_json, '$.text'),
      ''
    ));
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
  CREATE TRIGGER session_node_search_delete AFTER DELETE ON session_nodes BEGIN
    DELETE FROM session_node_search WHERE node_id = old.id;
    DELETE FROM session_node_discovery_search WHERE node_id = old.id;
    DELETE FROM session_transcript_embedding_queue WHERE node_id = old.id;
    DELETE FROM session_transcript_embeddings WHERE node_id = old.id;
    INSERT INTO session_discovery_embedding_queue (session_id, queued_at)
    VALUES (old.session_id, unixepoch('subsec') * 1000)
    ON CONFLICT(session_id) DO UPDATE SET queued_at = excluded.queued_at;
    ${refreshTranscriptScopeCoverageSql('old.session_id')}
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

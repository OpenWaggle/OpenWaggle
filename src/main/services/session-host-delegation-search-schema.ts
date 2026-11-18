export const SESSION_DELEGATION_SEARCH_SCHEMA_STATEMENTS = [
  `
  CREATE VIRTUAL TABLE session_delegation_search USING fts5(
    session_id UNINDEXED,
    delegation_id UNINDEXED,
    objective,
    tokenize = 'unicode61 remove_diacritics 2'
  )
  `,
  `
  CREATE TRIGGER session_delegation_search_insert AFTER INSERT ON delegation_specifications BEGIN
    DELETE FROM session_delegation_search WHERE delegation_id = new.delegation_id;
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
    INSERT INTO session_delegation_search (session_id, delegation_id, objective)
    SELECT contracts.child_session_id, contracts.id,
      COALESCE(json_extract(specifications.specification_json, '$.objective'), '')
    FROM delegation_contracts AS contracts
    JOIN delegation_specifications AS specifications
      ON specifications.delegation_id = contracts.id
      AND specifications.revision = contracts.current_specification_revision
    WHERE contracts.id = old.delegation_id;
    INSERT INTO session_discovery_embedding_queue (session_id, queued_at)
    SELECT contracts.child_session_id, unixepoch('subsec') * 1000
    FROM delegation_contracts AS contracts WHERE contracts.id = old.delegation_id
    ON CONFLICT(session_id) DO UPDATE SET queued_at = excluded.queued_at;
  END
  `,
] as const

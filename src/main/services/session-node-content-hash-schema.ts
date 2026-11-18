/**
 * Keeps a stored `session_nodes.content_hash` honest for any writer (D6): an update that changes
 * a node's content or metadata but leaves its digest as it was clears the digest instead, so
 * snapshot persistence compares that node by its content.
 */
export const SESSION_NODE_CONTENT_HASH_GUARD_TRIGGER = `
  CREATE TRIGGER IF NOT EXISTS session_nodes_content_hash_guard
  AFTER UPDATE OF content_json, metadata_json ON session_nodes
  WHEN NEW.content_hash IS NOT NULL
    AND NEW.content_hash IS OLD.content_hash
    AND (NEW.content_json IS NOT OLD.content_json OR NEW.metadata_json IS NOT OLD.metadata_json)
  BEGIN
    UPDATE session_nodes SET content_hash = NULL WHERE rowid = NEW.rowid;
  END
`

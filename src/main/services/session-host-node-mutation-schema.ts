export const SESSION_NODE_MUTATION_REVISION_SCHEMA_STATEMENTS = [
  `
  CREATE TRIGGER session_nodes_mutation_revision_update
  AFTER UPDATE ON session_nodes
  BEGIN
    UPDATE session_control_states
    SET node_mutation_revision = node_mutation_revision + 1
    WHERE session_id = OLD.session_id;
    UPDATE session_control_states
    SET node_mutation_revision = node_mutation_revision + 1
    WHERE session_id = NEW.session_id AND NEW.session_id <> OLD.session_id;
  END
  `,
  `
  CREATE TRIGGER session_nodes_mutation_revision_historical_insert
  AFTER INSERT ON session_nodes
  WHEN EXISTS (
    SELECT 1 FROM session_nodes AS existing
    WHERE existing.session_id = NEW.session_id
      AND existing.id <> NEW.id
      AND existing.created_order >= NEW.created_order
  )
  BEGIN
    UPDATE session_control_states
    SET node_mutation_revision = node_mutation_revision + 1
    WHERE session_id = NEW.session_id;
  END
  `,
  `
  CREATE TRIGGER session_nodes_mutation_revision_delete
  AFTER DELETE ON session_nodes
  BEGIN
    UPDATE session_control_states
    SET node_mutation_revision = node_mutation_revision + 1
    WHERE session_id = OLD.session_id;
  END
  `,
] as const

import type { AppMigration } from './database-migrations'
import { SESSION_NODE_MUTATION_REVISION_COLUMNS_MIGRATION_ID } from './session-host-schema-identity'

/**
 * The columns of a Session node whose update changes what a reader holds of it. A write of
 * `content_hash` alone, as the first snapshot after migration 80 makes for every row it stored
 * before digests existed, changes nothing a reader sees.
 */
const NODE_MUTATION_COLUMNS = [
  'id',
  'session_id',
  'parent_id',
  'pi_entry_type',
  'kind',
  'role',
  'timestamp_ms',
  'content_json',
  'metadata_json',
  'branch_hint_id',
  'path_depth',
  'created_order',
].join(', ')

/**
 * Narrows `session_nodes_mutation_revision_update` to those columns (D6). It fired on any update,
 * so a Session's first snapshot after the upgrade, which stores the digest of each existing row,
 * bumped `node_mutation_revision` once per row (0 to 7,929 on a real beta.27 Session): every
 * window holding the Session lost its delta and transcript reuse, and a sliced term rebuild of it
 * started over. The trigger body is unchanged.
 */
export const SESSION_NODE_MUTATION_REVISION_COLUMNS_MIGRATION: AppMigration = {
  id: SESSION_NODE_MUTATION_REVISION_COLUMNS_MIGRATION_ID,
  name: 'session-node-mutation-revision-columns',
  statements: [
    'DROP TRIGGER IF EXISTS session_nodes_mutation_revision_update',
    `
    CREATE TRIGGER session_nodes_mutation_revision_update
    AFTER UPDATE OF ${NODE_MUTATION_COLUMNS} ON session_nodes
    BEGIN
      UPDATE session_control_states
      SET node_mutation_revision = node_mutation_revision + 1
      WHERE session_id = OLD.session_id;
      UPDATE session_control_states
      SET node_mutation_revision = node_mutation_revision + 1
      WHERE session_id = NEW.session_id AND NEW.session_id <> OLD.session_id;
    END
    `,
  ],
}

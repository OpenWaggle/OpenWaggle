import {
  CURRENT_SESSION_RESOURCE_SCHEMA_STATEMENTS,
  SESSION_RESOURCE_BACKFILL_SCHEMA_STATEMENT,
  SESSION_RESOURCE_CLEANUP_QUEUE_SCHEMA_STATEMENT,
} from './database-schema'
import { SESSION_OUTPUT_RETRY_SCHEMA_STATEMENT } from './database-session-output-retry-schema'
import {
  runSessionResourceIdentityIsolationMigration,
  SESSION_RESOURCE_IDENTITY_ISOLATION_MIGRATION_STATEMENTS,
} from './database-session-resource-identity-migration'
import { SESSION_RESOURCE_LOCAL_IMAGE_BACKFILL_MIGRATION_ID } from './session-host-schema-identity'

export const SESSION_RESOURCE_MIGRATIONS = [
  {
    id: 29,
    name: 'session-resource-catalog',
    statements: CURRENT_SESSION_RESOURCE_SCHEMA_STATEMENTS,
  },
  {
    id: 30,
    name: 'session-resource-backfill-state',
    statements: [SESSION_RESOURCE_BACKFILL_SCHEMA_STATEMENT],
  },
  {
    id: 31,
    name: 'session-resource-cleanup-queue',
    statements: [SESSION_RESOURCE_CLEANUP_QUEUE_SCHEMA_STATEMENT],
  },
  {
    id: 32,
    name: 'session-output-retry-queue',
    statements: [SESSION_OUTPUT_RETRY_SCHEMA_STATEMENT],
  },
  {
    id: 33,
    name: 'session-output-retry-node-provenance',
    skipIfColumn: { table: 'session_output_retries', column: 'node_id' },
    statements: [`ALTER TABLE session_output_retries ADD COLUMN node_id TEXT`],
  },
  {
    id: 34,
    name: 'session-output-retry-branch-provenance',
    skipIfColumn: { table: 'session_output_retries', column: 'branch_id' },
    statements: [`ALTER TABLE session_output_retries ADD COLUMN branch_id TEXT`],
  },
  {
    id: 35,
    name: 'session-resource-identity-isolation',
    run: runSessionResourceIdentityIsolationMigration,
    statements: SESSION_RESOURCE_IDENTITY_ISOLATION_MIGRATION_STATEMENTS,
  },
  {
    id: 36,
    name: 'session-output-retry-metadata-revision',
    skipIfColumn: { table: 'session_output_retries', column: 'updated_at' },
    statements: [
      `ALTER TABLE session_output_retries ADD COLUMN updated_at INTEGER NOT NULL DEFAULT 0`,
    ],
  },
  {
    id: 37,
    name: 'session-output-retry-metadata-revision-backfill',
    statements: [`UPDATE session_output_retries SET updated_at = created_at WHERE updated_at = 0`],
  },
  {
    id: 38,
    name: 'session-resource-occurrence-locator',
    skipIfColumn: { table: 'session_resource_occurrences', column: 'locator' },
    statements: [`ALTER TABLE session_resource_occurrences ADD COLUMN locator TEXT`],
  },
  {
    id: 39,
    name: 'session-resource-source-projection',
    skipIfColumn: { table: 'session_resources', column: 'is_source' },
    statements: [`ALTER TABLE session_resources ADD COLUMN is_source INTEGER NOT NULL DEFAULT 0`],
  },
  {
    id: 40,
    name: 'session-resource-output-projection',
    skipIfColumn: { table: 'session_resources', column: 'is_output' },
    statements: [`ALTER TABLE session_resources ADD COLUMN is_output INTEGER NOT NULL DEFAULT 0`],
  },
  {
    id: 41,
    name: 'session-resource-role-projection-backfill',
    statements: [
      `
      UPDATE session_resources
      SET is_source = EXISTS (
            SELECT 1 FROM session_resource_occurrences occurrence
            WHERE occurrence.resource_id = session_resources.id
              AND occurrence.activity IN ('provided', 'read')
          ),
          is_output = EXISTS (
            SELECT 1 FROM session_resource_occurrences occurrence
            WHERE occurrence.resource_id = session_resources.id
              AND occurrence.activity IN ('created', 'updated')
          )
      `,
    ],
  },
  {
    id: 42,
    name: 'session-resource-bounded-catalog-indexes',
    statements: [
      `CREATE INDEX IF NOT EXISTS idx_session_resources_source_updated
       ON session_resources (session_id, is_source, updated_at DESC, id ASC)`,
      `CREATE INDEX IF NOT EXISTS idx_session_resources_output_updated
       ON session_resources (session_id, is_output, updated_at DESC, id ASC)`,
      `CREATE INDEX IF NOT EXISTS idx_session_resources_image_created
       ON session_resources (session_id, kind, created_at ASC, id ASC)`,
      `CREATE INDEX IF NOT EXISTS idx_session_resource_occurrences_node_resource
       ON session_resource_occurrences (node_id, resource_id)`,
    ],
  },
  {
    id: 43,
    name: 'session-resource-active-branch-order-index',
    statements: [
      `CREATE INDEX IF NOT EXISTS idx_session_resource_occurrences_resource_branch_created
       ON session_resource_occurrences (resource_id, branch_id, created_at ASC, id ASC)`,
    ],
  },
  {
    id: 44,
    name: 'session-resource-catalog-revision',
    statements: [
      `CREATE TABLE IF NOT EXISTS session_resource_catalog_state (
         session_id TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
         revision INTEGER NOT NULL DEFAULT 0
       )`,
      `INSERT INTO session_resource_catalog_state (session_id, revision)
       SELECT resource.session_id, COUNT(*)
       FROM session_resources resource
       GROUP BY resource.session_id
       ON CONFLICT(session_id) DO NOTHING`,
      `CREATE TRIGGER IF NOT EXISTS trg_session_resource_catalog_resource_insert
       AFTER INSERT ON session_resources BEGIN
         INSERT INTO session_resource_catalog_state (session_id, revision) VALUES (NEW.session_id, 1)
         ON CONFLICT(session_id) DO UPDATE SET revision = revision + 1;
       END`,
      `CREATE TRIGGER IF NOT EXISTS trg_session_resource_catalog_resource_update
       AFTER UPDATE ON session_resources BEGIN
         UPDATE session_resource_catalog_state
         SET revision = revision + 1
         WHERE session_id = NEW.session_id;
       END`,
      `CREATE TRIGGER IF NOT EXISTS trg_session_resource_catalog_resource_delete
       AFTER DELETE ON session_resources BEGIN
         UPDATE session_resource_catalog_state
         SET revision = revision + 1
         WHERE session_id = OLD.session_id;
       END`,
      `CREATE TRIGGER IF NOT EXISTS trg_session_resource_catalog_occurrence_insert
       AFTER INSERT ON session_resource_occurrences BEGIN
         UPDATE session_resource_catalog_state
         SET revision = revision + 1
         WHERE session_id = (
           SELECT session_id FROM session_resources WHERE id = NEW.resource_id
         );
       END`,
      `CREATE TRIGGER IF NOT EXISTS trg_session_resource_catalog_occurrence_update
       AFTER UPDATE ON session_resource_occurrences BEGIN
         UPDATE session_resource_catalog_state
         SET revision = revision + 1
         WHERE session_id = (
           SELECT session_id FROM session_resources WHERE id = NEW.resource_id
         );
       END`,
      `CREATE TRIGGER IF NOT EXISTS trg_session_resource_catalog_occurrence_delete
       AFTER DELETE ON session_resource_occurrences BEGIN
         UPDATE session_resource_catalog_state
         SET revision = revision + 1
         WHERE session_id = (
           SELECT session_id FROM session_resources WHERE id = OLD.resource_id
         );
      END`,
    ],
  },
  {
    id: 45,
    name: 'session-resource-change-request-catalog-index',
    statements: [
      `CREATE INDEX IF NOT EXISTS idx_session_resources_change_request_updated
       ON session_resources (session_id, kind, is_output, updated_at DESC, id ASC)`,
    ],
  },
  {
    id: 46,
    name: 'session-resource-occurrence-display-name',
    skipIfColumn: { table: 'session_resource_occurrences', column: 'display_name' },
    statements: [`ALTER TABLE session_resource_occurrences ADD COLUMN display_name TEXT`],
  },
  {
    id: 47,
    name: 'session-resource-occurrence-display-order',
    skipIfColumn: { table: 'session_resource_occurrences', column: 'display_order' },
    statements: [`ALTER TABLE session_resource_occurrences ADD COLUMN display_order INTEGER`],
  },
  {
    id: 48,
    name: 'session-resource-display-metadata-reindex',
    statements: [
      `UPDATE session_resource_occurrences
       SET display_name = COALESCE(display_name, label),
           display_order = COALESCE(
             display_order,
             CAST(substr(id, length(rtrim(id, '0123456789')) + 1) AS INTEGER)
           )
       WHERE actor = 'user'
         AND activity = 'provided'
         AND id LIKE '%:provided:attachment:%'
         AND id GLOB '*:[0-9]*'
         AND label IS NOT NULL
         AND (display_name IS NULL OR display_order IS NULL)`,
      `DELETE FROM session_resource_backfill_state
       WHERE EXISTS (
         SELECT 1
         FROM session_resources resource
         INNER JOIN session_resource_occurrences occurrence
           ON occurrence.resource_id = resource.id
         WHERE resource.session_id = session_resource_backfill_state.session_id
           AND resource.kind = 'image'
           AND occurrence.actor IN ('user', 'agent', 'tool')
           AND occurrence.node_id IS NOT NULL
           AND (occurrence.display_name IS NULL OR occurrence.display_order IS NULL)
       )`,
    ],
  },
] as const

export const SESSION_RESOURCE_LOCAL_IMAGE_BACKFILL_MIGRATION = {
  id: SESSION_RESOURCE_LOCAL_IMAGE_BACKFILL_MIGRATION_ID,
  name: 'session-resource-local-markdown-image-backfill',
  statements: [
    `DELETE FROM session_resource_occurrences
     WHERE EXISTS (
       SELECT 1
       FROM session_resources resource
       INNER JOIN session_nodes node
         ON node.id = session_resource_occurrences.node_id
        AND node.session_id = resource.session_id
       WHERE resource.id = session_resource_occurrences.resource_id
         AND resource.kind = 'image'
         AND node.role = 'assistant'
         AND node.content_json LIKE '%![%'
         AND node.content_json LIKE '%file://%'
     )`,
    `DELETE FROM session_resource_backfill_state
     WHERE EXISTS (
       SELECT 1 FROM session_nodes node
       WHERE node.session_id = session_resource_backfill_state.session_id
         AND node.role = 'assistant'
         AND node.content_json LIKE '%![%'
         AND node.content_json LIKE '%file://%'
     )`,
  ],
} as const

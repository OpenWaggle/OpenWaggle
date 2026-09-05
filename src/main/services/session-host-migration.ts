import type { AppMigration } from './database-migrations'
import {
  SESSION_HOST_BASELINE_MIGRATION_ID,
  SESSION_HOST_BASELINE_MIGRATION_NAME,
  SESSION_HOST_LAZY_SEMANTIC_SCOPE_MIGRATION_ID,
  SESSION_HOST_LAZY_SEMANTIC_SCOPE_MIGRATION_NAME,
} from './session-host-schema-identity'
import { SESSION_NODE_SEARCH_TRIGGER_SCHEMA_STATEMENTS } from './session-host-search-schema'
import { SESSION_HOST_TARGET_SCHEMA_STATEMENTS } from './session-host-target-schema'

export const SESSION_HOST_DATABASE_MIGRATION = {
  id: SESSION_HOST_BASELINE_MIGRATION_ID,
  name: SESSION_HOST_BASELINE_MIGRATION_NAME,
  statements: [...SESSION_HOST_TARGET_SCHEMA_STATEMENTS],
} satisfies AppMigration

export const SESSION_HOST_LAZY_SEMANTIC_SCOPE_MIGRATION = {
  id: SESSION_HOST_LAZY_SEMANTIC_SCOPE_MIGRATION_ID,
  name: SESSION_HOST_LAZY_SEMANTIC_SCOPE_MIGRATION_NAME,
  skipIfColumns: {
    table: 'session_transcript_semantic_scopes',
    columns: ['source_revision', 'prepared_source_revision'],
  },
  statements: [
    `ALTER TABLE session_transcript_semantic_scopes
      ADD COLUMN source_revision INTEGER NOT NULL DEFAULT 0 CHECK (source_revision >= 0)`,
    `ALTER TABLE session_transcript_semantic_scopes
      ADD COLUMN prepared_source_revision INTEGER NOT NULL DEFAULT -1
      CHECK (prepared_source_revision >= -1)`,
    `DROP TRIGGER session_node_search_insert`,
    `DROP TRIGGER session_node_search_update`,
    `DROP TRIGGER session_node_search_delete`,
    `DROP TRIGGER session_node_discovery_search_delete`,
    ...SESSION_NODE_SEARCH_TRIGGER_SCHEMA_STATEMENTS,
  ],
} satisfies AppMigration

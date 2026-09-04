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

export const SESSION_RESOURCE_MIGRATIONS = [
  {
    id: 27,
    name: 'session-resource-catalog',
    statements: CURRENT_SESSION_RESOURCE_SCHEMA_STATEMENTS,
  },
  {
    id: 28,
    name: 'session-resource-backfill-state',
    statements: [SESSION_RESOURCE_BACKFILL_SCHEMA_STATEMENT],
  },
  {
    id: 29,
    name: 'session-resource-cleanup-queue',
    statements: [SESSION_RESOURCE_CLEANUP_QUEUE_SCHEMA_STATEMENT],
  },
  {
    id: 30,
    name: 'session-output-retry-queue',
    statements: [SESSION_OUTPUT_RETRY_SCHEMA_STATEMENT],
  },
  {
    id: 31,
    name: 'session-output-retry-node-provenance',
    skipIfColumn: { table: 'session_output_retries', column: 'node_id' },
    statements: [`ALTER TABLE session_output_retries ADD COLUMN node_id TEXT`],
  },
  {
    id: 32,
    name: 'session-output-retry-branch-provenance',
    skipIfColumn: { table: 'session_output_retries', column: 'branch_id' },
    statements: [`ALTER TABLE session_output_retries ADD COLUMN branch_id TEXT`],
  },
  {
    id: 33,
    name: 'session-resource-identity-isolation',
    run: runSessionResourceIdentityIsolationMigration,
    statements: SESSION_RESOURCE_IDENTITY_ISOLATION_MIGRATION_STATEMENTS,
  },
  {
    id: 34,
    name: 'session-output-retry-metadata-revision',
    skipIfColumn: { table: 'session_output_retries', column: 'updated_at' },
    statements: [
      `ALTER TABLE session_output_retries ADD COLUMN updated_at INTEGER NOT NULL DEFAULT 0`,
    ],
  },
  {
    id: 35,
    name: 'session-output-retry-metadata-revision-backfill',
    statements: [`UPDATE session_output_retries SET updated_at = created_at WHERE updated_at = 0`],
  },
] as const

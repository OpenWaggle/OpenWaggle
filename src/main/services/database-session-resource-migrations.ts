import {
  CURRENT_SESSION_RESOURCE_SCHEMA_STATEMENTS,
  SESSION_RESOURCE_BACKFILL_SCHEMA_STATEMENT,
  SESSION_RESOURCE_CLEANUP_QUEUE_SCHEMA_STATEMENT,
} from './database-schema'
import { SESSION_OUTPUT_RETRY_SCHEMA_STATEMENT } from './database-session-output-retry-schema'

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
] as const

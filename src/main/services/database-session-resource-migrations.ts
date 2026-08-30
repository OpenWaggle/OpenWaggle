import {
  CURRENT_SESSION_RESOURCE_SCHEMA_STATEMENTS,
  SESSION_RESOURCE_BACKFILL_SCHEMA_STATEMENT,
} from './database-schema'

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
] as const

import type { AppMigration } from './database-migrations'
import { SESSION_DISCOVERY_TERM_POPULATION_STATEMENTS } from './session-host-discovery-term-population'
import { SESSION_DISCOVERY_TERM_SCHEMA_STATEMENTS } from './session-host-discovery-term-schema'
import { SESSION_DISCOVERY_TERM_TRIGGER_SCHEMA_STATEMENTS } from './session-host-discovery-term-triggers'
import {
  SESSION_HOST_DISCOVERY_TERM_MIGRATION_ID,
  SESSION_HOST_DISCOVERY_TERM_MIGRATION_NAME,
} from './session-host-schema-identity'

export const SESSION_HOST_DISCOVERY_TERM_MIGRATION = {
  id: SESSION_HOST_DISCOVERY_TERM_MIGRATION_ID,
  name: SESSION_HOST_DISCOVERY_TERM_MIGRATION_NAME,
  skipIfColumns: {
    table: 'session_discovery_term_postings',
    columns: [
      'session_id',
      'term',
      'search_rowid',
      'initial_frequency',
      'preview_frequency',
      'token_count',
    ],
  },
  statements: [
    ...SESSION_DISCOVERY_TERM_SCHEMA_STATEMENTS,
    ...SESSION_DISCOVERY_TERM_POPULATION_STATEMENTS,
    ...SESSION_DISCOVERY_TERM_TRIGGER_SCHEMA_STATEMENTS,
  ],
} satisfies AppMigration

import type { AppMigration } from './database-migrations'
import { SESSION_PROJECT_CATALOG_GENERATION_SCHEMA_STATEMENTS } from './session-host-project-catalog-generation-schema'
import { SESSION_HOST_PROJECT_CATALOG_GENERATION_MIGRATION_ID } from './session-host-schema-identity'

export const SESSION_HOST_PROJECT_CATALOG_GENERATION_MIGRATION = {
  id: SESSION_HOST_PROJECT_CATALOG_GENERATION_MIGRATION_ID,
  name: 'session-host-project-catalog-generation',
  statements: [...SESSION_PROJECT_CATALOG_GENERATION_SCHEMA_STATEMENTS],
} satisfies AppMigration

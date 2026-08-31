import type { AppMigration } from './database-migrations'
import {
  SESSION_HOST_BASELINE_MIGRATION_ID,
  SESSION_HOST_BASELINE_MIGRATION_NAME,
} from './session-host-schema-identity'
import { SESSION_HOST_TARGET_SCHEMA_STATEMENTS } from './session-host-target-schema'

export const SESSION_HOST_DATABASE_MIGRATION = {
  id: SESSION_HOST_BASELINE_MIGRATION_ID,
  name: SESSION_HOST_BASELINE_MIGRATION_NAME,
  statements: [...SESSION_HOST_TARGET_SCHEMA_STATEMENTS],
} satisfies AppMigration

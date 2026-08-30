import type { AppMigration } from './database-migrations'
import { SESSION_HOST_TARGET_SCHEMA_STATEMENTS } from './session-host-target-schema'

export const SESSION_HOST_DATABASE_MIGRATION = {
  id: 26,
  name: 'session-host-v2-target-schema',
  statements: [...SESSION_HOST_TARGET_SCHEMA_STATEMENTS],
} satisfies AppMigration

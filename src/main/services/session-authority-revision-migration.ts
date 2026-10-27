import type { AppMigration } from './database-migrations'
import { SESSION_AUTHORITY_REVISION_SCHEMA_STATEMENTS } from './session-authority-revision-schema'
import { SESSION_AUTHORITY_REVISION_MIGRATION_ID } from './session-host-schema-identity'

/** The durable authority revision the Host's authority drift monitor reads (D4). */
export const SESSION_AUTHORITY_REVISION_MIGRATION: AppMigration = {
  id: SESSION_AUTHORITY_REVISION_MIGRATION_ID,
  name: 'session-authority-revision',
  statements: [...SESSION_AUTHORITY_REVISION_SCHEMA_STATEMENTS],
}

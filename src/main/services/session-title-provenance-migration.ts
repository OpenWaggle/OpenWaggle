import { DEFAULT_SESSION_TITLE } from '@shared/session-title-source'
import type { AppMigration } from './database-migrations'
import { SESSION_TITLE_PROVENANCE_MIGRATION_ID } from './session-host-schema-identity'

/**
 * Records where each Session title came from and whether it is owed one Title refinement
 * (ADR 0043). Titles that predate the migration cannot be told apart, so they become `manual` and
 * generation never touches them; only still-untitled Sessions become `default`.
 */
export const SESSION_TITLE_PROVENANCE_MIGRATION = {
  id: SESSION_TITLE_PROVENANCE_MIGRATION_ID,
  name: 'session-title-provenance',
  skipIfColumns: { table: 'sessions', columns: ['title_source', 'title_needs_refinement'] },
  statements: [
    `ALTER TABLE sessions ADD COLUMN title_source TEXT NOT NULL DEFAULT 'manual'
      CHECK (title_source IN ('default', 'provisional', 'generated', 'manual'))`,
    `ALTER TABLE sessions ADD COLUMN title_needs_refinement INTEGER NOT NULL DEFAULT 0
      CHECK (title_needs_refinement IN (0, 1))`,
    `UPDATE sessions SET title_source = 'default' WHERE title = '${DEFAULT_SESSION_TITLE}'`,
  ],
} satisfies AppMigration

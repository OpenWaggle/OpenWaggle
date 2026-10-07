import type { AppMigration } from './database-migrations'
import { PI_SESSION_ADOPTION_MIGRATION_ID } from './session-host-schema-identity'

/**
 * Records which Sessions use a Pi session file OpenWaggle discovered rather than created
 * (ADR 0048), and which discovered files the user removed from OpenWaggle. Removing a discovered
 * Session keeps its file for the program that made it, so discovery must not list it again.
 * Additive only: nothing existing is changed.
 */
export const PI_SESSION_ADOPTION_MIGRATION = {
  id: PI_SESSION_ADOPTION_MIGRATION_ID,
  name: 'pi-session-adoption',
  statements: [
    `CREATE TABLE IF NOT EXISTS pi_session_adoptions (
      session_id TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
      adopted_at INTEGER NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS pi_session_dismissals (
      pi_session_file TEXT PRIMARY KEY,
      pi_session_id TEXT NOT NULL,
      dismissed_at INTEGER NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS idx_pi_session_dismissals_pi_session_id
      ON pi_session_dismissals (pi_session_id)`,
  ],
} satisfies AppMigration

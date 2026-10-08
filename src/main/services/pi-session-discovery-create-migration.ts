import type { AppMigration } from './database-migrations'
import { PI_SESSION_DISCOVERY_CREATE_MIGRATION_ID } from './session-host-schema-identity'

/**
 * Records each lifecycle create Pi session discovery sends, by idempotency key, before it is sent
 * (ADR 0050). The Host start removes only the empty Sessions these name, so a Session someone
 * created with a key under discovery's prefix is never taken for one an interrupted pass left.
 * Additive only.
 */
export const PI_SESSION_DISCOVERY_CREATE_MIGRATION = {
  id: PI_SESSION_DISCOVERY_CREATE_MIGRATION_ID,
  name: 'pi-session-discovery-creates',
  statements: [
    `CREATE TABLE IF NOT EXISTS pi_session_discovery_creates (
      idempotency_key TEXT PRIMARY KEY,
      created_at INTEGER NOT NULL
    )`,
  ],
} satisfies AppMigration

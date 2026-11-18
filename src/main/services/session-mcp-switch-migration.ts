import type { AppMigration } from './database-migrations'
import { SESSION_MCP_SWITCH_MIGRATION_ID } from './session-host-schema-identity'

/**
 * Session-level MCP off (ADR 0051) as durable Session state: one row per Session the user switched
 * MCP off for. Sessions are on unless they have a row, and deleting a Session drops its row.
 * Additive only: nothing existing is changed.
 */
export const SESSION_MCP_SWITCH_MIGRATION = {
  id: SESSION_MCP_SWITCH_MIGRATION_ID,
  name: 'session-mcp-switch',
  statements: [
    `CREATE TABLE IF NOT EXISTS session_mcp_disabled (
      session_id TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
      disabled_at INTEGER NOT NULL
    )`,
  ],
} satisfies AppMigration

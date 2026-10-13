import type { DatabaseMigrationDefinition } from './database-migration-types'
import { PI_SESSION_ADOPTION_MIGRATION } from './pi-session-adoption-migration'
import { PI_SESSION_DISCOVERY_CREATE_MIGRATION } from './pi-session-discovery-create-migration'
import { PI_SESSION_FILE_STATE_MIGRATION } from './pi-session-file-state-migration'
import { SESSION_MCP_SWITCH_MIGRATION } from './session-mcp-switch-migration'

/** Migrations 65 to 68: discovered Pi sessions, their file state, and a Session's MCP switch. */
export const PI_ECOSYSTEM_MIGRATIONS: readonly DatabaseMigrationDefinition[] = [
  PI_SESSION_ADOPTION_MIGRATION,
  PI_SESSION_FILE_STATE_MIGRATION,
  SESSION_MCP_SWITCH_MIGRATION,
  PI_SESSION_DISCOVERY_CREATE_MIGRATION,
]

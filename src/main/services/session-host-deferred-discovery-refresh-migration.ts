import type { AppMigration } from './database-migrations'
import { SESSION_HOST_DEFERRED_DISCOVERY_REFRESH_MIGRATION_ID } from './session-host-schema-identity'
import { SESSION_NODE_SEARCH_TRIGGER_SCHEMA_STATEMENTS } from './session-host-search-schema'

/**
 * Lets a bulk node writer rebuild a Session's lexical discovery row once instead of once per
 * node (#357). The node triggers gain a guard on `session_lexical_discovery_deferrals`.
 */
export const SESSION_HOST_DEFERRED_DISCOVERY_REFRESH_MIGRATION = {
  id: SESSION_HOST_DEFERRED_DISCOVERY_REFRESH_MIGRATION_ID,
  name: 'session-host-deferred-discovery-refresh',
  statements: [
    'DROP TRIGGER IF EXISTS session_node_search_insert',
    'DROP TRIGGER IF EXISTS session_node_search_update',
    'DROP TRIGGER IF EXISTS session_node_search_delete',
    'DROP TRIGGER IF EXISTS session_node_discovery_search_delete',
    ...SESSION_NODE_SEARCH_TRIGGER_SCHEMA_STATEMENTS,
  ],
} satisfies AppMigration

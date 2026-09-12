import type { AppMigration } from './database-migrations'
import {
  SESSION_HOST_NODE_DELETE_MIGRATION_ID,
  SESSION_HOST_NODE_DELETE_MIGRATION_NAME,
} from './session-host-schema-identity'
import { SESSION_NODE_SEARCH_DELETE_TRIGGER_SCHEMA_STATEMENT } from './session-host-search-schema'

export const SESSION_HOST_NODE_DELETE_MIGRATION = {
  id: SESSION_HOST_NODE_DELETE_MIGRATION_ID,
  name: SESSION_HOST_NODE_DELETE_MIGRATION_NAME,
  statements: [
    'DROP TRIGGER IF EXISTS session_node_search_delete',
    SESSION_NODE_SEARCH_DELETE_TRIGGER_SCHEMA_STATEMENT,
  ],
} satisfies AppMigration

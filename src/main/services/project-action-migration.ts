import { SESSION_HOST_PROJECT_ACTION_MIGRATION_ID } from './session-host-schema-identity'

export const PROJECT_ACTION_MIGRATION = {
  id: SESSION_HOST_PROJECT_ACTION_MIGRATION_ID,
  name: 'native-project-actions',
  statements: [
    `CREATE TABLE project_action_catalogs (
      project_path TEXT PRIMARY KEY,
      revision INTEGER NOT NULL CHECK (revision > 0),
      state_json TEXT NOT NULL CHECK (json_valid(state_json)),
      updated_at INTEGER NOT NULL
    )`,
  ],
} as const

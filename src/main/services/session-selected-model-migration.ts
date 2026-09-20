import { SESSION_SELECTED_MODEL_MIGRATION_STATEMENTS } from './database-schema'

export const SESSION_SELECTED_MODEL_MIGRATION = {
  id: 49,
  name: 'session-selected-model',
  skipIfColumn: { table: 'sessions', column: 'selected_model' },
  statements: [...SESSION_SELECTED_MODEL_MIGRATION_STATEMENTS],
} as const

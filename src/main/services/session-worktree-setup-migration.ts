import { SESSION_WORKTREE_SETUP_MIGRATION_STATEMENTS } from './database-schema'

export const SESSION_WORKTREE_SETUP_MIGRATION = {
  id: 26,
  name: 'session-worktree-setup-dispatch',
  statements: [...SESSION_WORKTREE_SETUP_MIGRATION_STATEMENTS],
} as const

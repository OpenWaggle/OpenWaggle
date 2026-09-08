import { SESSION_WORKTREE_SETUP_RECEIPT_MIGRATION_STATEMENTS } from './database-schema'

export const SESSION_WORKTREE_SETUP_RECEIPT_MIGRATION = {
  id: 27,
  name: 'session-worktree-setup-receipt',
  statements: [...SESSION_WORKTREE_SETUP_RECEIPT_MIGRATION_STATEMENTS],
} as const

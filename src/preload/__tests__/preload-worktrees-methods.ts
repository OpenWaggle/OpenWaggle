import type { OpenWaggleApi } from '@shared/types/openwaggle-api'

/** The preload worktree methods, and those behind Settings > Worktrees (ADR 0060). */
export const PRELOAD_WORKTREES_METHODS = [
  'listGitWorktrees',
  'createGitWorktree',
  'removeGitWorktree',
  'getWorktreeInventory',
  'measureWorktree',
  'archiveAndRemoveWorktree',
  'getAutomaticWorktreeRemovalLog',
  'acknowledgeAutomaticWorktreeRemoval',
] as const satisfies readonly (keyof OpenWaggleApi)[]

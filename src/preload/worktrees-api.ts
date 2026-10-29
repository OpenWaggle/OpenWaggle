import { invoke } from './ipc-bindings'

/** Worktree listing, creation and removal, and Settings > Worktrees (ADR 0060). */
export const worktreesApi = {
  listGitWorktrees: invoke('git:worktrees:list'),
  createGitWorktree: invoke('git:worktrees:create'),
  removeGitWorktree: invoke('git:worktrees:remove'),
  checkSessionWorktree: invoke('git:worktrees:check'),
  getWorktreeInventory: invoke('worktrees:inventory'),
  measureWorktree: invoke('worktrees:measure'),
  archiveAndRemoveWorktree: invoke('worktrees:archive-and-remove'),
  getAutomaticWorktreeRemovalLog: invoke('worktrees:automatic-removal-log'),
  acknowledgeAutomaticWorktreeRemoval: invoke('worktrees:acknowledge-automatic-removal'),
}

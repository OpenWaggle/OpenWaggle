import { homedir } from 'node:os'
import path from 'node:path'

/** The folder every OpenWaggle-managed worktree is created under. */
export function managedWorktreeRoot() {
  return path.join(homedir(), '.openwaggle', 'worktrees')
}

/** Stable managed-worktree path keyed by Workspace identity, not by one member Session. */
export function resolveWorkspaceWorktreePath(primaryPath: string, workspaceId: string) {
  const repoName = path.basename(primaryPath.replace(/\/+$/, '')) || 'repo'
  return path.join(managedWorktreeRoot(), repoName, workspaceId)
}

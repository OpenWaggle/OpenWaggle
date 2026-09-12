import { homedir } from 'node:os'
import path from 'node:path'

/** Stable managed-worktree path keyed by Workspace identity, not by one member Session. */
export function resolveWorkspaceWorktreePath(primaryPath: string, workspaceId: string) {
  const repoName = path.basename(primaryPath.replace(/\/+$/, '')) || 'repo'
  return path.join(homedir(), '.openwaggle', 'worktrees', repoName, workspaceId)
}

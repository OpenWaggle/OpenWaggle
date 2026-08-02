import { registerGitBranchHandlers } from './branches-handler'
import { registerGitCommitHandlers } from './commit-handler'
import { registerGitStatusHandlers } from './status-handler'
import { registerGitVcsStatusHandlers } from './vcs-status-handler'
import { registerGitWorkingTreeHandlers } from './working-tree-handler'
import { registerGitWorktreeHandlers } from './worktree-handler'

export { invalidateGitStatusCache, normalizeGitPath } from './status-handler'

export function registerGitHandlers(): void {
  registerGitStatusHandlers()
  registerGitCommitHandlers()
  registerGitBranchHandlers()
  registerGitWorkingTreeHandlers()
  registerGitWorktreeHandlers()
  registerGitVcsStatusHandlers()
}

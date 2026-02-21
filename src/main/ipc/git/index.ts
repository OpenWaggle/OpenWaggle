import { registerGitBranchHandlers } from './branches-handler'
import { registerGitCommitHandlers } from './commit-handler'
import { registerGitStatusHandlers } from './status-handler'

export { normalizeGitPath } from './status-handler'

export function registerGitHandlers(): void {
  registerGitStatusHandlers()
  registerGitCommitHandlers()
  registerGitBranchHandlers()
}

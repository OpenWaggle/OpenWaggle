import { selectWorkingTreeStatus, useGitStore } from '@/features/git/state/git-store'
import { useActiveWorkingPath, useRepositoryPath } from './useActiveWorkingPath'

/**
 * Git state for the active session's Working path.
 *
 * Reads resolve the working tree automatically so callers cannot report on the
 * wrong one. Mutations still take an explicit path, because the caller knows
 * whether it is acting on a working tree or on the repository.
 */
export function useGit() {
  const workingPath = useActiveWorkingPath()
  const repositoryPath = useRepositoryPath()
  const workingTree = useGitStore((s) => selectWorkingTreeStatus(s, workingPath))
  const branches = useGitStore((s) => s.branches)
  const isCommitting = useGitStore((s) => s.isCommitting)
  const isBranchActionRunning = useGitStore((s) => s.isBranchActionRunning)
  const branchesError = useGitStore((s) => s.branchesError)
  const refreshStatus = useGitStore((s) => s.refreshStatus)
  const refreshBranches = useGitStore((s) => s.refreshBranches)
  const commit = useGitStore((s) => s.commit)
  const checkoutBranch = useGitStore((s) => s.checkoutBranch)
  const createBranch = useGitStore((s) => s.createBranch)

  return {
    workingPath,
    repositoryPath,
    status: workingTree.status,
    isLoading: workingTree.isLoading,
    error: workingTree.error ?? branchesError,
    branches,
    isCommitting,
    isBranchActionRunning,
    refreshStatus,
    refreshBranches,
    commit,
    checkoutBranch,
    createBranch,
  }
}

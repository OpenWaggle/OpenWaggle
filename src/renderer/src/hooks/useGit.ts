import { useGitStore } from '@/stores/git-store'

export function useGit() {
  const status = useGitStore((s) => s.status)
  const branches = useGitStore((s) => s.branches)
  const isLoading = useGitStore((s) => s.isLoading)
  const isCommitting = useGitStore((s) => s.isCommitting)
  const isBranchActionRunning = useGitStore((s) => s.isBranchActionRunning)
  const statusError = useGitStore((s) => s.statusError)
  const branchesError = useGitStore((s) => s.branchesError)
  const error = statusError ?? branchesError
  const refreshStatus = useGitStore((s) => s.refreshStatus)
  const refreshBranches = useGitStore((s) => s.refreshBranches)
  const commit = useGitStore((s) => s.commit)
  const checkoutBranch = useGitStore((s) => s.checkoutBranch)
  const createBranch = useGitStore((s) => s.createBranch)
  const renameBranch = useGitStore((s) => s.renameBranch)
  const deleteBranch = useGitStore((s) => s.deleteBranch)
  const setUpstream = useGitStore((s) => s.setUpstream)

  return {
    status,
    branches,
    isLoading,
    isCommitting,
    isBranchActionRunning,
    error,
    refreshStatus,
    refreshBranches,
    commit,
    checkoutBranch,
    createBranch,
    renameBranch,
    deleteBranch,
    setUpstream,
  }
}

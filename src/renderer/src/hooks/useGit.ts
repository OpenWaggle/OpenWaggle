import { useGitStore } from '@/stores/git-store'

export function useGit() {
  const status = useGitStore((s) => s.status)
  const isLoading = useGitStore((s) => s.isLoading)
  const isCommitting = useGitStore((s) => s.isCommitting)
  const error = useGitStore((s) => s.error)
  const refreshStatus = useGitStore((s) => s.refreshStatus)
  const commit = useGitStore((s) => s.commit)

  return {
    status,
    isLoading,
    isCommitting,
    error,
    refreshStatus,
    commit,
  }
}

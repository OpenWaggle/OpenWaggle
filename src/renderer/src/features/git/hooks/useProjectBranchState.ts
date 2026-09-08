import type { RepositoryPath } from '@shared/types/brand'
import type { GitBranchListResult } from '@shared/types/git'
import { useGitStore } from '@/features/git/state/git-store'

export type ProjectBranchStatus = 'project-required' | 'loading' | 'ready' | 'empty' | 'error'

interface ProjectBranchState {
  readonly names: readonly string[]
  readonly currentBranch: string | null
  readonly status: ProjectBranchStatus
}

function resolveProjectBranchState(input: {
  readonly projectPath: string | null
  readonly branches: GitBranchListResult | null
  readonly repositoryPath: RepositoryPath | null
  readonly isLoading: boolean
  readonly error: string | null
}): ProjectBranchState {
  if (!input.projectPath) {
    return { names: [], currentBranch: null, status: 'project-required' }
  }
  if (input.repositoryPath !== input.projectPath) {
    return { names: [], currentBranch: null, status: 'loading' }
  }
  if (input.error) return { names: [], currentBranch: null, status: 'error' }
  if (!input.branches && input.isLoading) {
    return { names: [], currentBranch: null, status: 'loading' }
  }

  const names =
    input.branches?.branches.flatMap((branch) => (branch.isRemote ? [] : [branch.name])) ?? []
  const currentBranch = input.branches?.currentBranch ?? null
  return {
    names,
    currentBranch,
    status: currentBranch || (input.branches?.branches.length ?? 0) > 0 ? 'ready' : 'empty',
  }
}

/** Project-keyed view of the global repository branch snapshot. */
export function useProjectBranchState(projectPath: string | null): ProjectBranchState {
  const branches = useGitStore((state) => state.branches)
  const repositoryPath = useGitStore((state) => state.branchesRepositoryPath)
  const isLoading = useGitStore((state) => state.isLoadingBranches)
  const error = useGitStore((state) => state.branchesError)
  return resolveProjectBranchState({ projectPath, branches, repositoryPath, isLoading, error })
}

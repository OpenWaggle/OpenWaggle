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
}) {
  if (!input.projectPath) {
    const state: ProjectBranchState = {
      names: [],
      currentBranch: null,
      status: 'project-required',
    }
    return state
  }
  if (input.repositoryPath !== input.projectPath) {
    const state: ProjectBranchState = { names: [], currentBranch: null, status: 'loading' }
    return state
  }
  if (input.error) {
    const state: ProjectBranchState = { names: [], currentBranch: null, status: 'error' }
    return state
  }
  if (!input.branches && input.isLoading) {
    const state: ProjectBranchState = { names: [], currentBranch: null, status: 'loading' }
    return state
  }

  const names =
    input.branches?.branches.flatMap((branch) => (branch.isRemote ? [] : [branch.name])) ?? []
  const currentBranch = input.branches?.currentBranch ?? null
  const state: ProjectBranchState = {
    names,
    currentBranch,
    status: currentBranch || (input.branches?.branches.length ?? 0) > 0 ? 'ready' : 'empty',
  }
  return state
}

/** Project-keyed view of the global repository branch snapshot. */
export function useProjectBranchState(projectPath: string | null) {
  const branches = useGitStore((state) => state.branches)
  const repositoryPath = useGitStore((state) => state.branchesRepositoryPath)
  const isLoading = useGitStore((state) => state.isLoadingBranches)
  const error = useGitStore((state) => state.branchesError)
  return resolveProjectBranchState({
    projectPath,
    branches,
    repositoryPath,
    isLoading,
    error,
  })
}

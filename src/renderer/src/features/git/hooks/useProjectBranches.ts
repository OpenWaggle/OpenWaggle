import { RepositoryPath } from '@shared/types/brand'
import { useEffect, useState } from 'react'
import { api } from '@/shared/lib/ipc'
import { createRendererLogger } from '@/shared/lib/logger'

const logger = createRendererLogger('composer-project-branches')
const EMPTY_BRANCH_NAMES: readonly string[] = []

export type ProjectBranchStatus = 'project-required' | 'loading' | 'ready' | 'empty' | 'error'

interface LoadedBranches {
  readonly projectPath: string
  readonly status: 'ready' | 'error'
  readonly currentBranch: string | null
  readonly names: readonly string[]
}

interface ProjectBranches {
  readonly status: ProjectBranchStatus
  readonly currentBranch: string | null
  readonly names: readonly string[]
}

/** Loads branch choices without exposing stale results while the selected project changes. */
export function useProjectBranches(projectPath: string | null): ProjectBranches {
  const [loaded, setLoaded] = useState<LoadedBranches | null>(null)

  useEffect(() => {
    if (!projectPath) return
    let cancelled = false
    void api
      .listGitBranches(RepositoryPath(projectPath))
      .then((result) => {
        if (cancelled) return
        setLoaded({
          projectPath,
          status: 'ready',
          currentBranch: result.currentBranch,
          names: result.branches.flatMap((branch) => (branch.isRemote ? [] : [branch.name])),
        })
      })
      .catch((error) => {
        if (!cancelled) {
          setLoaded({ projectPath, status: 'error', currentBranch: null, names: [] })
        }
        logger.warn('Failed to list branches for context strip', { error: String(error) })
      })
    return () => {
      cancelled = true
    }
  }, [projectPath])

  if (!projectPath) {
    return { status: 'project-required', currentBranch: null, names: EMPTY_BRANCH_NAMES }
  }
  if (loaded?.projectPath !== projectPath) {
    return { status: 'loading', currentBranch: null, names: EMPTY_BRANCH_NAMES }
  }
  if (loaded.status === 'error') {
    return { status: 'error', currentBranch: null, names: EMPTY_BRANCH_NAMES }
  }
  if (!loaded.currentBranch && loaded.names.length === 0) {
    return { status: 'empty', currentBranch: null, names: EMPTY_BRANCH_NAMES }
  }
  return { status: 'ready', currentBranch: loaded.currentBranch, names: loaded.names }
}

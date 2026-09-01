import { RepositoryPath } from '@shared/types/brand'
import type { GitBranchListResult } from '@shared/types/git'
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { useGitStore } from '../../state/git-store'
import {
  PROJECTLESS_DRAFT_WORKTREE_PLAN_KEY,
  prepareDraftWorktreePlan,
  useWorktreePlanStore,
} from '../../state/worktree-plan-store'
import { useSessionContextRow } from '../useSessionContextRow'

const MAIN_BRANCH_RESULT: GitBranchListResult = {
  currentBranch: 'main',
  branches: [
    {
      name: 'main',
      fullName: 'main',
      isCurrent: true,
      isRemote: false,
      upstream: null,
      ahead: 0,
      behind: 0,
    },
  ],
}

describe('useSessionContextRow project-first setup', () => {
  beforeEach(() => {
    useWorktreePlanStore.setState({ bySessionId: {} })
    useGitStore.setState({
      branches: null,
      branchesRepositoryPath: null,
      isLoadingBranches: false,
      branchesError: null,
    })
  })

  it('preserves a projectless environment choice while branches load for the selected project', () => {
    const initialProps: { projectPath: string | null } = { projectPath: null }
    const { result, rerender } = renderHook(
      ({ projectPath }: { projectPath: string | null }) =>
        useSessionContextRow({
          sessionId: null,
          projectPath,
          isFirstMessage: true,
          session: null,
          defaultEnvironmentMode: 'local',
        }),
      { initialProps },
    )

    expect(result.current.visible).toBe(true)
    expect(result.current.branchStatus).toBe('project-required')

    act(() => result.current.setEnvMode('worktree'))
    expect(result.current.envMode).toBe('worktree')
    expect(
      useWorktreePlanStore.getState().bySessionId[PROJECTLESS_DRAFT_WORKTREE_PLAN_KEY],
    ).toEqual({ envMode: 'worktree' })

    // Project selection starts, then the user changes the still-visible control
    // before preference persistence publishes the selected project path.
    act(() => prepareDraftWorktreePlan(null, '/test/project'))
    act(() => result.current.setEnvMode('local'))
    rerender({ projectPath: '/test/project' })

    expect(result.current.envMode).toBe('local')
    expect(result.current.branchStatus).toBe('loading')

    act(() => {
      useGitStore.setState({
        branches: MAIN_BRANCH_RESULT,
        branchesRepositoryPath: RepositoryPath('/test/project'),
        isLoadingBranches: false,
        branchesError: null,
      })
    })

    expect(result.current.branchStatus).toBe('ready')
    expect(result.current.baseRef).toBe('main')
    expect(result.current.branchNames).toEqual(['main'])

    act(() => result.current.setEnvMode('worktree'))
    expect(result.current.envMode).toBe('worktree')

    act(() => result.current.setBaseRef('develop'))

    expect(result.current.envMode).toBe('worktree')
    expect(result.current.baseRef).toBe('develop')

    act(() => useGitStore.setState({ isLoadingBranches: true }))
    expect(result.current.branchStatus).toBe('ready')
    expect(result.current.branchNames).toEqual(['main'])

    act(() =>
      useGitStore.setState({
        isLoadingBranches: false,
        branches: {
          currentBranch: null,
          branches: [
            {
              name: 'origin/main',
              fullName: 'origin/main',
              isCurrent: false,
              isRemote: true,
              upstream: null,
              ahead: 0,
              behind: 0,
            },
          ],
        },
      }),
    )
    expect(result.current.branchStatus).toBe('ready')
    expect(result.current.branchNames).toEqual([])
  })
})

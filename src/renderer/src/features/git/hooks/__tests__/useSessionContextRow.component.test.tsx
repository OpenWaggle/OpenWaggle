import type { GitBranchListResult } from '@shared/types/git'
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '@/shared/lib/ipc'
import {
  PROJECTLESS_DRAFT_WORKTREE_PLAN_KEY,
  useWorktreePlanStore,
} from '../../state/worktree-plan-store'
import { useSessionContextRow } from '../useSessionContextRow'

vi.mock('@/shared/lib/ipc', () => ({
  api: {
    listGitBranches: vi.fn(),
  },
}))

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
    vi.clearAllMocks()
    useWorktreePlanStore.setState({ bySessionId: {} })
  })

  it('preserves a projectless environment choice while branches load for the selected project', async () => {
    let resolveBranches: (branches: GitBranchListResult) => void = () => {}
    vi.mocked(api.listGitBranches).mockReturnValue(
      new Promise((resolve) => {
        resolveBranches = resolve
      }),
    )
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

    rerender({ projectPath: '/test/project' })

    expect(result.current.envMode).toBe('worktree')
    expect(result.current.branchStatus).toBe('loading')

    act(() => resolveBranches(MAIN_BRANCH_RESULT))

    await waitFor(() => expect(result.current.branchStatus).toBe('ready'))
    expect(result.current.baseRef).toBe('main')
    expect(result.current.branchNames).toEqual(['main'])
  })
})

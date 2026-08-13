import { beforeEach, describe, expect, it, vi } from 'vitest'

const { apiMock } = vi.hoisted(() => ({
  apiMock: {
    getGitStatus: vi.fn(),
    listGitBranches: vi.fn(),
    commitGit: vi.fn(),
    checkoutGitBranch: vi.fn(),
    createGitBranch: vi.fn(),
  },
}))

vi.mock('@/shared/lib/ipc', () => ({ api: apiMock }))

import { selectWorkingTreeStatus, useGitStore } from '../git-store'
import {
  GIT_STORE_RESET_STATE,
  makeBranchList,
  makeGitStatus,
  PROJECT_PATH,
  statusFor,
} from './git-store.test-utils'

/** Status slice for one working tree, via the store's own selector. */
function sliceFor(workingPath: string) {
  return selectWorkingTreeStatus(useGitStore.getState(), workingPath)
}

describe('useGitStore status and branch refresh behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useGitStore.setState(GIT_STORE_RESET_STATE)
  })

  describe('refreshStatus', () => {
    it('does not fetch and leaves other trees untouched when the working path is null', async () => {
      useGitStore.setState({ statusByWorkingPath: statusFor(PROJECT_PATH) })

      await useGitStore.getState().refreshStatus(null)

      // A null path is "no session selected", not "wipe what other trees know".
      expect(sliceFor(PROJECT_PATH).status?.branch).toBe('main')
      expect(apiMock.getGitStatus).not.toHaveBeenCalled()
    })

    it('sets isLoading true then false on successful fetch', async () => {
      const states: boolean[] = []
      const unsubscribe = useGitStore.subscribe((state) =>
        states.push(selectWorkingTreeStatus(state, PROJECT_PATH).isLoading),
      )
      apiMock.getGitStatus.mockResolvedValue(makeGitStatus())

      await useGitStore.getState().refreshStatus(PROJECT_PATH)

      unsubscribe()
      expect(states).toContain(true)
      expect(sliceFor(PROJECT_PATH).isLoading).toBe(false)
    })

    it('sets statusError when getGitStatus throws an Error', async () => {
      apiMock.getGitStatus.mockRejectedValue(new Error('git not found'))

      await useGitStore.getState().refreshStatus(PROJECT_PATH)

      expect(sliceFor(PROJECT_PATH).status).toBeNull()
      expect(sliceFor(PROJECT_PATH).error).toBe('git not found')
      expect(sliceFor(PROJECT_PATH).isLoading).toBe(false)
    })

    it('sets fallback statusError when thrown value is not an Error', async () => {
      apiMock.getGitStatus.mockRejectedValue('string error')

      await useGitStore.getState().refreshStatus(PROJECT_PATH)

      expect(sliceFor(PROJECT_PATH).error).toBe('Failed to load Git status.')
      expect(sliceFor(PROJECT_PATH).isLoading).toBe(false)
    })

    it('clears the error on subsequent success', async () => {
      useGitStore.setState({
        statusByWorkingPath: {
          [PROJECT_PATH]: { status: null, isLoading: false, error: 'previous error' },
        },
      })
      apiMock.getGitStatus.mockResolvedValue(
        makeGitStatus({
          branch: 'dev',
          additions: 2,
          deletions: 1,
          filesChanged: 3,
          clean: false,
          ahead: 1,
        }),
      )

      await useGitStore.getState().refreshStatus(PROJECT_PATH)

      expect(sliceFor(PROJECT_PATH).error).toBeNull()
      expect(sliceFor(PROJECT_PATH).status?.branch).toBe('dev')
    })

    // Two trees now coexist, so a slow response must land on its own key rather than
    // overwriting whichever tree was refreshed most recently.
    it('keeps each working tree independent and ignores its own stale responses', async () => {
      let resolveFirst: ((status: ReturnType<typeof makeGitStatus>) => void) | undefined
      apiMock.getGitStatus
        .mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              resolveFirst = resolve
            }),
        )
        .mockResolvedValueOnce(makeGitStatus({ branch: 'project-b' }))

      const firstRefresh = useGitStore.getState().refreshStatus('/repo-a')
      await useGitStore.getState().refreshStatus('/repo-b')
      resolveFirst?.(makeGitStatus({ branch: 'project-a' }))
      await firstRefresh

      // Both are retained, each under its own path: this is what a single slot could
      // not express, and why two sessions on two worktrees used to fight.
      expect(sliceFor('/repo-b').status?.branch).toBe('project-b')
      expect(sliceFor('/repo-a').status?.branch).toBe('project-a')
    })
  })

  describe('refreshBranches', () => {
    it('clears branches and error when projectPath is null', async () => {
      useGitStore.setState({ branches: makeBranchList(), branchesError: 'old error' })

      await useGitStore.getState().refreshBranches(null)

      expect(useGitStore.getState().branches).toBeNull()
      expect(useGitStore.getState().branchesError).toBeNull()
      expect(apiMock.listGitBranches).not.toHaveBeenCalled()
    })

    it('sets branchesError when listGitBranches throws an Error', async () => {
      apiMock.listGitBranches.mockRejectedValue(new Error('permission denied'))

      await useGitStore.getState().refreshBranches(PROJECT_PATH)

      expect(useGitStore.getState().branches).toBeNull()
      expect(useGitStore.getState().branchesError).toBe('permission denied')
    })

    it('sets fallback branchesError when thrown value is not an Error', async () => {
      apiMock.listGitBranches.mockRejectedValue(42)

      await useGitStore.getState().refreshBranches(PROJECT_PATH)

      expect(useGitStore.getState().branchesError).toBe('Failed to load Git branches.')
    })

    it('clears branchesError on success', async () => {
      useGitStore.setState({ branchesError: 'previous' })
      apiMock.listGitBranches.mockResolvedValue(makeBranchList())

      await useGitStore.getState().refreshBranches(PROJECT_PATH)

      expect(useGitStore.getState().branchesError).toBeNull()
      expect(useGitStore.getState().branches).toEqual(makeBranchList())
    })
  })
})

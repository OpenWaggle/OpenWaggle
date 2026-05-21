import { beforeEach, describe, expect, it, vi } from 'vitest'

const { apiMock } = vi.hoisted(() => ({
  apiMock: {
    getGitStatus: vi.fn(),
    listGitBranches: vi.fn(),
    commitGit: vi.fn(),
    checkoutGitBranch: vi.fn(),
    createGitBranch: vi.fn(),
    renameGitBranch: vi.fn(),
    deleteGitBranch: vi.fn(),
    setGitBranchUpstream: vi.fn(),
  },
}))

vi.mock('@/shared/lib/ipc', () => ({ api: apiMock }))

import { useGitStore } from '../git-store'
import {
  GIT_STORE_RESET_STATE,
  makeBranchList,
  makeGitStatus,
  PROJECT_PATH,
} from './git-store.test-utils'

describe('useGitStore status and branch refresh behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useGitStore.setState(GIT_STORE_RESET_STATE)
  })

  describe('refreshStatus', () => {
    it('clears status and error when projectPath is null', async () => {
      useGitStore.setState({
        status: makeGitStatus({ branch: 'old' }),
        statusError: 'old error',
        isLoading: true,
      })

      await useGitStore.getState().refreshStatus(null)

      expect(useGitStore.getState().status).toBeNull()
      expect(useGitStore.getState().statusError).toBeNull()
      expect(useGitStore.getState().isLoading).toBe(false)
      expect(apiMock.getGitStatus).not.toHaveBeenCalled()
    })

    it('sets isLoading true then false on successful fetch', async () => {
      const states: boolean[] = []
      const unsubscribe = useGitStore.subscribe((state) => states.push(state.isLoading))
      apiMock.getGitStatus.mockResolvedValue(makeGitStatus())

      await useGitStore.getState().refreshStatus(PROJECT_PATH)

      unsubscribe()
      expect(states).toContain(true)
      expect(useGitStore.getState().isLoading).toBe(false)
    })

    it('sets statusError when getGitStatus throws an Error', async () => {
      apiMock.getGitStatus.mockRejectedValue(new Error('git not found'))

      await useGitStore.getState().refreshStatus(PROJECT_PATH)

      expect(useGitStore.getState().status).toBeNull()
      expect(useGitStore.getState().statusError).toBe('git not found')
      expect(useGitStore.getState().isLoading).toBe(false)
    })

    it('sets fallback statusError when thrown value is not an Error', async () => {
      apiMock.getGitStatus.mockRejectedValue('string error')

      await useGitStore.getState().refreshStatus(PROJECT_PATH)

      expect(useGitStore.getState().statusError).toBe('Failed to load Git status.')
      expect(useGitStore.getState().isLoading).toBe(false)
    })

    it('clears statusError on subsequent success', async () => {
      useGitStore.setState({ statusError: 'previous error' })
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

      expect(useGitStore.getState().statusError).toBeNull()
      expect(useGitStore.getState().status?.branch).toBe('dev')
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

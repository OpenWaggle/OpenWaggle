import { RepositoryPath } from '@shared/types/brand'
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

import { useGitStore } from '../git-store'
import { GIT_STORE_RESET_STATE, REPOSITORY_PATH, WORKING_PATH } from './git-store.test-utils'

describe('useGitStore branch action behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useGitStore.setState(GIT_STORE_RESET_STATE)
  })

  describe('checkoutBranch', () => {
    it('returns a visible failure result when checkout IPC throws', async () => {
      apiMock.checkoutGitBranch.mockRejectedValue(new Error('checkout failed'))

      const result = await useGitStore
        .getState()
        .checkoutBranch(WORKING_PATH, REPOSITORY_PATH, { name: 'broken' })

      expect(result).toEqual({ ok: false, code: 'unknown', message: 'checkout failed' })
      expect(useGitStore.getState().isBranchActionRunning).toBe(false)
    })

    it('does not refresh when checkout result is not ok', async () => {
      apiMock.checkoutGitBranch.mockResolvedValue({
        ok: false,
        code: 'dirty-worktree',
        message: 'Uncommitted changes.',
      })

      const result = await useGitStore
        .getState()
        .checkoutBranch(WORKING_PATH, REPOSITORY_PATH, { name: 'dirty' })

      expect(result.ok).toBe(false)
      expect(apiMock.getGitStatus).not.toHaveBeenCalled()
      expect(apiMock.listGitBranches).not.toHaveBeenCalled()
      expect(useGitStore.getState().isBranchActionRunning).toBe(false)
    })

    it('does not replace a newly selected repository after an older checkout completes', async () => {
      let resolveCheckout: ((result: { ok: true }) => void) | undefined
      apiMock.checkoutGitBranch.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveCheckout = resolve
          }),
      )
      apiMock.getGitStatus.mockResolvedValue(null)
      apiMock.listGitBranches.mockResolvedValue({ currentBranch: 'repo-b', branches: [] })
      useGitStore.setState({ branchesRepositoryPath: REPOSITORY_PATH })

      const checkout = useGitStore
        .getState()
        .checkoutBranch(WORKING_PATH, REPOSITORY_PATH, { name: 'feature' })
      await useGitStore.getState().refreshBranches(RepositoryPath('/repo-b'))
      resolveCheckout?.({ ok: true })
      await checkout

      expect(apiMock.listGitBranches).toHaveBeenCalledTimes(1)
      expect(useGitStore.getState().branchesRepositoryPath).toBe('/repo-b')
      expect(useGitStore.getState().branches?.currentBranch).toBe('repo-b')
    })
  })
})

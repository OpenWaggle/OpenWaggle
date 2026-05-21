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

describe('useGitStore branch action behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useGitStore.setState(GIT_STORE_RESET_STATE)
  })

  describe('setUpstream', () => {
    it('refreshes status and branches on successful upstream set', async () => {
      apiMock.setGitBranchUpstream.mockResolvedValue({ ok: true, message: 'Upstream set.' })
      apiMock.getGitStatus.mockResolvedValue(makeGitStatus())
      apiMock.listGitBranches.mockResolvedValue(makeBranchList())

      const result = await useGitStore.getState().setUpstream(PROJECT_PATH, {
        name: 'feature',
        upstream: 'origin/feature',
      })

      expect(result.ok).toBe(true)
      expect(apiMock.getGitStatus).toHaveBeenCalledWith(PROJECT_PATH)
      expect(apiMock.listGitBranches).toHaveBeenCalledWith(PROJECT_PATH)
      expect(useGitStore.getState().isBranchActionRunning).toBe(false)
    })

    it('does not refresh when setUpstream fails', async () => {
      apiMock.setGitBranchUpstream.mockResolvedValue({
        ok: false,
        code: 'upstream-not-found',
        message: 'Remote tracking branch not found.',
      })

      const result = await useGitStore.getState().setUpstream(PROJECT_PATH, {
        name: 'feature',
        upstream: 'origin/missing',
      })

      expect(result.ok).toBe(false)
      expect(apiMock.getGitStatus).not.toHaveBeenCalled()
      expect(useGitStore.getState().isBranchActionRunning).toBe(false)
    })

    it('returns a visible failure result when upstream IPC throws', async () => {
      apiMock.setGitBranchUpstream.mockRejectedValue(new Error('net error'))

      const result = await useGitStore.getState().setUpstream(PROJECT_PATH, {
        name: 'x',
        upstream: 'origin/x',
      })

      expect(result).toEqual({ ok: false, code: 'unknown', message: 'net error' })
      expect(useGitStore.getState().isBranchActionRunning).toBe(false)
    })
  })

  describe('checkoutBranch', () => {
    it('returns a visible failure result when checkout IPC throws', async () => {
      apiMock.checkoutGitBranch.mockRejectedValue(new Error('checkout failed'))

      const result = await useGitStore.getState().checkoutBranch(PROJECT_PATH, { name: 'broken' })

      expect(result).toEqual({ ok: false, code: 'unknown', message: 'checkout failed' })
      expect(useGitStore.getState().isBranchActionRunning).toBe(false)
    })

    it('does not refresh when checkout result is not ok', async () => {
      apiMock.checkoutGitBranch.mockResolvedValue({
        ok: false,
        code: 'dirty-worktree',
        message: 'Uncommitted changes.',
      })

      const result = await useGitStore.getState().checkoutBranch(PROJECT_PATH, { name: 'dirty' })

      expect(result.ok).toBe(false)
      expect(apiMock.getGitStatus).not.toHaveBeenCalled()
      expect(apiMock.listGitBranches).not.toHaveBeenCalled()
      expect(useGitStore.getState().isBranchActionRunning).toBe(false)
    })
  })

  describe('deleteBranch', () => {
    it('refreshes on successful deletion', async () => {
      apiMock.deleteGitBranch.mockResolvedValue({
        ok: true,
        message: 'Deleted branch old-feature.',
      })
      apiMock.getGitStatus.mockResolvedValue(makeGitStatus())
      apiMock.listGitBranches.mockResolvedValue(makeBranchList())

      const result = await useGitStore.getState().deleteBranch(PROJECT_PATH, {
        name: 'old-feature',
        force: true,
      })

      expect(result.ok).toBe(true)
      expect(apiMock.getGitStatus).toHaveBeenCalledWith(PROJECT_PATH)
      expect(apiMock.listGitBranches).toHaveBeenCalledWith(PROJECT_PATH)
      expect(useGitStore.getState().isBranchActionRunning).toBe(false)
    })

    it('returns a visible failure result when delete IPC throws', async () => {
      apiMock.deleteGitBranch.mockRejectedValue(new Error('IPC down'))

      const result = await useGitStore.getState().deleteBranch(PROJECT_PATH, {
        name: 'x',
        force: false,
      })

      expect(result).toEqual({ ok: false, code: 'unknown', message: 'IPC down' })
      expect(useGitStore.getState().isBranchActionRunning).toBe(false)
    })
  })
})

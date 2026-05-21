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

describe('useGitStore create and rename branch behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useGitStore.setState(GIT_STORE_RESET_STATE)
  })

  describe('createBranch', () => {
    it('refreshes status and branches on successful creation', async () => {
      apiMock.createGitBranch.mockResolvedValue({
        ok: true,
        message: 'Created branch feature/new.',
      })
      apiMock.getGitStatus.mockResolvedValue(makeGitStatus())
      apiMock.listGitBranches.mockResolvedValue(makeBranchList())

      const result = await useGitStore.getState().createBranch(PROJECT_PATH, {
        name: 'feature/new',
        checkout: true,
      })

      expect(result).toEqual({ ok: true, message: 'Created branch feature/new.' })
      expect(apiMock.getGitStatus).toHaveBeenCalledWith(PROJECT_PATH)
      expect(apiMock.listGitBranches).toHaveBeenCalledWith(PROJECT_PATH)
      expect(useGitStore.getState().isBranchActionRunning).toBe(false)
    })

    it('does not refresh when creation fails', async () => {
      apiMock.createGitBranch.mockResolvedValue({
        ok: false,
        code: 'branch-exists',
        message: 'Branch already exists.',
      })

      const result = await useGitStore.getState().createBranch(PROJECT_PATH, { name: 'existing' })

      expect(result.ok).toBe(false)
      expect(apiMock.getGitStatus).not.toHaveBeenCalled()
      expect(apiMock.listGitBranches).not.toHaveBeenCalled()
      expect(useGitStore.getState().isBranchActionRunning).toBe(false)
    })

    it('returns a visible failure result when create IPC throws', async () => {
      apiMock.createGitBranch.mockRejectedValue(new Error('timeout'))

      const result = await useGitStore.getState().createBranch(PROJECT_PATH, { name: 'boom' })

      expect(result).toEqual({ ok: false, code: 'unknown', message: 'timeout' })
      expect(useGitStore.getState().isBranchActionRunning).toBe(false)
    })
  })

  describe('renameBranch', () => {
    it('refreshes status and branches on successful rename', async () => {
      apiMock.renameGitBranch.mockResolvedValue({ ok: true, message: 'Renamed branch.' })
      apiMock.getGitStatus.mockResolvedValue(makeGitStatus())
      apiMock.listGitBranches.mockResolvedValue(makeBranchList())

      const result = await useGitStore.getState().renameBranch(PROJECT_PATH, {
        from: 'old-name',
        to: 'new-name',
      })

      expect(result.ok).toBe(true)
      expect(apiMock.getGitStatus).toHaveBeenCalledWith(PROJECT_PATH)
      expect(apiMock.listGitBranches).toHaveBeenCalledWith(PROJECT_PATH)
      expect(useGitStore.getState().isBranchActionRunning).toBe(false)
    })

    it('does not refresh when rename fails', async () => {
      apiMock.renameGitBranch.mockResolvedValue({
        ok: false,
        code: 'invalid-name',
        message: 'Invalid branch name.',
      })

      const result = await useGitStore
        .getState()
        .renameBranch(PROJECT_PATH, { from: 'old', to: '..bad' })

      expect(result.ok).toBe(false)
      expect(apiMock.getGitStatus).not.toHaveBeenCalled()
      expect(useGitStore.getState().isBranchActionRunning).toBe(false)
    })

    it('returns a visible failure result when rename IPC throws', async () => {
      apiMock.renameGitBranch.mockRejectedValue(new Error('crash'))

      const result = await useGitStore.getState().renameBranch(PROJECT_PATH, { from: 'a', to: 'b' })

      expect(result).toEqual({ ok: false, code: 'unknown', message: 'crash' })
      expect(useGitStore.getState().isBranchActionRunning).toBe(false)
    })
  })
})

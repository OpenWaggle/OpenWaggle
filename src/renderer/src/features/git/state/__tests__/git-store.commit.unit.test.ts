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
import { GIT_STORE_RESET_STATE, makeGitStatus, PROJECT_PATH } from './git-store.test-utils'

describe('useGitStore commit behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useGitStore.setState(GIT_STORE_RESET_STATE)
  })

  it('sets isCommitting during commit and refreshes status after success', async () => {
    apiMock.commitGit.mockResolvedValue({
      ok: true,
      commitHash: 'abc123',
      summary: '1 file changed',
    })
    apiMock.getGitStatus.mockResolvedValue(makeGitStatus({ ahead: 1 }))

    const result = await useGitStore.getState().commit(PROJECT_PATH, {
      message: 'test commit',
      amend: false,
      paths: ['file.ts'],
    })

    expect(result).toEqual({ ok: true, commitHash: 'abc123', summary: '1 file changed' })
    expect(useGitStore.getState().isCommitting).toBe(false)
    expect(apiMock.getGitStatus).toHaveBeenCalledWith(PROJECT_PATH)
  })

  it('does not refresh status when commit result is not ok', async () => {
    apiMock.commitGit.mockResolvedValue({
      ok: false,
      code: 'nothing-to-commit',
      message: 'Nothing to commit.',
    })

    const result = await useGitStore.getState().commit(PROJECT_PATH, {
      message: 'empty commit',
      amend: false,
      paths: [],
    })

    expect(result.ok).toBe(false)
    expect(apiMock.getGitStatus).not.toHaveBeenCalled()
    expect(useGitStore.getState().isCommitting).toBe(false)
  })

  it('returns a visible failure result when commitGit throws', async () => {
    apiMock.commitGit.mockRejectedValue(new Error('IPC failure'))

    const result = await useGitStore.getState().commit(PROJECT_PATH, {
      message: 'fail',
      amend: false,
      paths: [],
    })

    expect(result).toEqual({ ok: false, code: 'unknown', message: 'IPC failure' })
    expect(useGitStore.getState().isCommitting).toBe(false)
  })
})

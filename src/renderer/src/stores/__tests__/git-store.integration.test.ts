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

vi.mock('@/lib/ipc', () => ({
  api: apiMock,
}))

import { useGitStore } from '../git-store'

describe('useGitStore integration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useGitStore.setState({
      status: null,
      branches: null,
      isLoading: false,
      isCommitting: false,
      isBranchActionRunning: false,
      error: null,
    })
  })

  it('refreshes git status and branch list via IPC', async () => {
    apiMock.getGitStatus.mockResolvedValue({
      branch: 'main',
      additions: 1,
      deletions: 0,
      filesChanged: 1,
      changedFiles: [],
      clean: false,
      ahead: 0,
      behind: 0,
    })
    apiMock.listGitBranches.mockResolvedValue({
      currentBranch: 'main',
      branches: [
        {
          name: 'main',
          fullName: 'refs/heads/main',
          isCurrent: true,
          isRemote: false,
          upstream: 'origin/main',
          ahead: 0,
          behind: 0,
        },
      ],
    })

    await useGitStore.getState().refreshStatus('/tmp/repo')
    await useGitStore.getState().refreshBranches('/tmp/repo')

    expect(useGitStore.getState().status?.branch).toBe('main')
    expect(useGitStore.getState().branches?.branches).toHaveLength(1)
  })

  it('runs checkout branch mutation and refreshes git state on success', async () => {
    apiMock.checkoutGitBranch.mockResolvedValue({ ok: true, message: 'Switched to feature.' })
    apiMock.getGitStatus.mockResolvedValue({
      branch: 'feature',
      additions: 0,
      deletions: 0,
      filesChanged: 0,
      changedFiles: [],
      clean: true,
      ahead: 0,
      behind: 0,
    })
    apiMock.listGitBranches.mockResolvedValue({
      currentBranch: 'feature',
      branches: [
        {
          name: 'feature',
          fullName: 'refs/heads/feature',
          isCurrent: true,
          isRemote: false,
          upstream: null,
          ahead: 0,
          behind: 0,
        },
      ],
    })

    const result = await useGitStore.getState().checkoutBranch('/tmp/repo', { name: 'feature' })

    expect(result).toEqual({ ok: true, message: 'Switched to feature.' })
    expect(apiMock.getGitStatus).toHaveBeenCalledWith('/tmp/repo')
    expect(apiMock.listGitBranches).toHaveBeenCalledWith('/tmp/repo')
    expect(useGitStore.getState().isBranchActionRunning).toBe(false)
  })

  it('preserves failed branch mutation responses', async () => {
    apiMock.deleteGitBranch.mockResolvedValue({
      ok: false,
      code: 'branch-not-found',
      message: 'The requested branch could not be found.',
    })

    const result = await useGitStore.getState().deleteBranch('/tmp/repo', {
      name: 'missing',
      force: false,
    })

    expect(result).toEqual({
      ok: false,
      code: 'branch-not-found',
      message: 'The requested branch could not be found.',
    })
    expect(useGitStore.getState().isBranchActionRunning).toBe(false)
  })
})

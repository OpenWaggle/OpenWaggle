import { beforeEach, describe, expect, it, vi } from 'vitest'

const { isGitRepositoryMock, runGitMock } = vi.hoisted(() => ({
  isGitRepositoryMock: vi.fn(),
  runGitMock: vi.fn(),
}))

vi.mock('../shared', () => ({
  isGitRepository: isGitRepositoryMock,
  runGit: runGitMock,
}))

import { revertAllGitChanges, stageAllGitChanges } from '../working-tree-service'

describe('Git working-tree action failures', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    isGitRepositoryMock.mockResolvedValue(true)
  })

  it('reports a partial revert when tracked restoration succeeds but untracked cleanup fails', async () => {
    runGitMock
      .mockResolvedValueOnce({ stdout: 'head\n', stderr: '', code: 0 })
      .mockResolvedValueOnce({ stdout: '/repo\n', stderr: '', code: 0 })
      .mockResolvedValueOnce({ stdout: '', stderr: '', code: 0 })
      .mockResolvedValueOnce({ stdout: '', stderr: '', code: 0 })
      .mockResolvedValueOnce({ stdout: '', stderr: '', code: 0 })
      .mockResolvedValueOnce({ stdout: '', stderr: '', code: 0 })
      .mockResolvedValueOnce({ stdout: '', stderr: 'permission denied\n', code: 1 })

    await expect(revertAllGitChanges('/repo')).resolves.toEqual({
      ok: false,
      code: 'partial-revert',
      message:
        'Tracked changes were restored, but Git could not remove every untracked path: permission denied',
    })
  })

  it('rejects working-tree actions outside a Git repository', async () => {
    isGitRepositoryMock.mockResolvedValue(false)

    await expect(stageAllGitChanges('/not-a-repo')).resolves.toEqual({
      ok: false,
      code: 'not-git-repo',
      message: 'Selected folder is not a Git repository.',
    })
    expect(runGitMock).not.toHaveBeenCalled()
  })

  it('refuses destructive revert when the repository has no HEAD', async () => {
    runGitMock.mockResolvedValueOnce({ stdout: '', stderr: 'unknown revision\n', code: 1 })

    await expect(revertAllGitChanges('/repo')).resolves.toEqual({
      ok: false,
      code: 'no-head',
      message: 'Revert all requires a repository with at least one commit.',
    })
    expect(runGitMock).toHaveBeenCalledOnce()
    expect(runGitMock).toHaveBeenCalledWith('/repo', ['rev-parse', '--verify', 'HEAD'])
  })

  it('returns Git stage failures as user-facing results', async () => {
    runGitMock.mockResolvedValueOnce({ stdout: '', stderr: 'index.lock exists\n', code: 1 })

    await expect(stageAllGitChanges('/repo')).resolves.toEqual({
      ok: false,
      code: 'unknown',
      message: 'index.lock exists',
    })
  })
})

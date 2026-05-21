import { beforeEach, describe, expect, it, vi } from 'vitest'

const { isGitRepositoryMock, runGitMock } = vi.hoisted(() => ({
  isGitRepositoryMock: vi.fn(async () => true),
  runGitMock: vi.fn(async () => ({ code: 0, stdout: '', stderr: '' })),
}))

vi.mock('../shared', () => ({
  isGitRepository: isGitRepositoryMock,
  runGit: runGitMock,
}))

const {
  checkoutGitBranch,
  createGitBranch,
  deleteGitBranch,
  renameGitBranch,
  setGitBranchUpstream,
} = await import('../branch-mutations')

function gitResult(code: number, stdout = '', stderr = '') {
  return { code, stdout, stderr }
}

describe('git branch mutations', () => {
  beforeEach(() => {
    isGitRepositoryMock.mockReset()
    isGitRepositoryMock.mockResolvedValue(true)
    runGitMock.mockReset()
    runGitMock.mockResolvedValue(gitResult(0))
  })

  it('rejects operations outside git repositories before running branch commands', async () => {
    isGitRepositoryMock.mockResolvedValue(false)

    await expect(createGitBranch('/repo', { name: 'feature', checkout: false })).resolves.toEqual({
      ok: false,
      code: 'not-git-repo',
      message: 'Selected folder is not a Git repository.',
    })
    expect(runGitMock).not.toHaveBeenCalled()
  })

  it('validates, creates, and optionally checks out new branches', async () => {
    runGitMock
      .mockResolvedValueOnce(gitResult(0))
      .mockResolvedValueOnce(gitResult(1))
      .mockResolvedValueOnce(gitResult(0))
      .mockResolvedValueOnce(gitResult(0))

    await expect(
      createGitBranch('/repo', { name: ' feature ', startPoint: ' main ', checkout: true }),
    ).resolves.toEqual({ ok: true, message: 'Created and checked out feature.' })

    expect(runGitMock).toHaveBeenNthCalledWith(1, '/repo', [
      'check-ref-format',
      '--branch',
      'feature',
    ])
    expect(runGitMock).toHaveBeenNthCalledWith(2, '/repo', [
      'show-ref',
      '--verify',
      '--quiet',
      'refs/heads/feature',
    ])
    expect(runGitMock).toHaveBeenNthCalledWith(3, '/repo', ['branch', 'feature', 'main'])
    expect(runGitMock).toHaveBeenNthCalledWith(4, '/repo', ['checkout', 'feature'])
  })

  it('checks out remote tracking branches and prevents mismatched local tracking reuse', async () => {
    runGitMock
      .mockResolvedValueOnce(gitResult(0))
      .mockResolvedValueOnce(gitResult(0))
      .mockResolvedValueOnce(gitResult(0, 'origin/other\n'))

    await expect(checkoutGitBranch('/repo', { name: 'origin/feature' })).resolves.toEqual({
      ok: false,
      code: 'branch-exists',
      message: 'Local branch "feature" already exists and is not tracking "origin/feature".',
    })
  })

  it('maps git failures from rename, delete, and upstream mutations', async () => {
    runGitMock.mockResolvedValue(gitResult(1, '', 'fatal: not a valid object name: bad'))

    await expect(renameGitBranch('/repo', { from: 'old', to: 'bad name' })).resolves.toEqual({
      ok: false,
      code: 'invalid-name',
      message: 'Branch name is invalid.',
    })
    await expect(deleteGitBranch('/repo', { name: 'bad', force: true })).resolves.toEqual({
      ok: false,
      code: 'invalid-name',
      message: 'Branch name is invalid.',
    })
    await expect(
      setGitBranchUpstream('/repo', { name: 'bad', upstream: 'origin/bad' }),
    ).resolves.toEqual({
      ok: false,
      code: 'invalid-name',
      message: 'Branch name is invalid.',
    })
  })
})

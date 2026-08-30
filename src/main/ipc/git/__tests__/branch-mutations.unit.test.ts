import { beforeEach, describe, expect, it, vi } from 'vitest'

const { isGitRepositoryMock, runGitMock } = vi.hoisted(() => ({
  isGitRepositoryMock: vi.fn(async () => true),
  runGitMock: vi.fn(async () => ({ code: 0, stdout: '', stderr: '' })),
}))

vi.mock('../shared', () => ({
  isGitRepository: isGitRepositoryMock,
  runGit: runGitMock,
}))

const { checkoutGitBranch, createGitBranch } = await import('../branch-mutations')

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
    expect(runGitMock).toHaveBeenNthCalledWith(3, '/repo', [
      'for-each-ref',
      '--format=%(refname)',
      'refs/remotes',
    ])
    expect(runGitMock).toHaveBeenNthCalledWith(4, '/repo', ['branch', 'feature', 'main'])
    expect(runGitMock).toHaveBeenNthCalledWith(5, '/repo', ['checkout', 'feature'])
  })

  it('allows a branch whose name is only a suffix of a nested remote branch', async () => {
    runGitMock
      .mockResolvedValueOnce(gitResult(0))
      .mockResolvedValueOnce(gitResult(1))
      .mockResolvedValueOnce(gitResult(0, 'refs/remotes/origin/team/feature\n'))
      .mockResolvedValueOnce(gitResult(0))

    await expect(createGitBranch('/repo', { name: 'feature', checkout: false })).resolves.toEqual({
      ok: true,
      message: 'Created feature.',
    })
  })

  it('rejects an exact remote branch name collision', async () => {
    runGitMock
      .mockResolvedValueOnce(gitResult(0))
      .mockResolvedValueOnce(gitResult(1))
      .mockResolvedValueOnce(gitResult(0, 'refs/remotes/origin/feature\n'))

    await expect(createGitBranch('/repo', { name: 'feature', checkout: false })).resolves.toEqual({
      ok: false,
      code: 'branch-exists',
      message: 'A remote branch with this name already exists.',
    })
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
})

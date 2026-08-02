import { beforeEach, describe, expect, it, vi } from 'vitest'

const { isGitRepositoryMock, runGitMock } = vi.hoisted(() => ({
  isGitRepositoryMock: vi.fn(async () => true),
  runGitMock: vi.fn(async () => ({ code: 0, stdout: '', stderr: '' })),
}))

vi.mock('../shared', () => ({
  isGitRepository: isGitRepositoryMock,
  runGit: runGitMock,
}))

const { createGitWorktree, removeGitWorktree, listGitWorktrees, parseWorktreeList } = await import(
  '../worktree-service'
)

function gitResult(code: number, stdout = '', stderr = '') {
  return { code, stdout, stderr }
}

describe('worktree service', () => {
  beforeEach(() => {
    isGitRepositoryMock.mockReset()
    isGitRepositoryMock.mockResolvedValue(true)
    runGitMock.mockReset()
    runGitMock.mockResolvedValue(gitResult(0))
  })

  describe('createGitWorktree', () => {
    it('rejects non-git repositories before running commands', async () => {
      isGitRepositoryMock.mockResolvedValue(false)
      await expect(
        createGitWorktree('/repo', { path: '/wt/x', branch: 'feat', baseRef: 'main' }),
      ).resolves.toEqual({
        ok: false,
        code: 'not-git-repo',
        message: 'Selected folder is not a Git repository.',
      })
      expect(runGitMock).not.toHaveBeenCalled()
    })

    it('verifies the base ref then adds the worktree with a new branch', async () => {
      runGitMock
        .mockResolvedValueOnce(gitResult(0)) // rev-parse verify
        .mockResolvedValueOnce(gitResult(0)) // worktree add
      await expect(
        createGitWorktree('/repo', { path: ' /wt/x ', branch: ' feat ', baseRef: ' main ' }),
      ).resolves.toEqual({ ok: true, message: 'Created worktree on feat.', path: '/wt/x' })

      expect(runGitMock).toHaveBeenNthCalledWith(1, '/repo', [
        'rev-parse',
        '--verify',
        'main^{commit}',
      ])
      expect(runGitMock).toHaveBeenNthCalledWith(2, '/repo', [
        'worktree',
        'add',
        '-b',
        'feat',
        '/wt/x',
        'main',
      ])
    })

    it('maps an unresolvable base ref to base-ref-not-found', async () => {
      runGitMock.mockResolvedValueOnce(gitResult(128, '', 'fatal: bad revision'))
      await expect(
        createGitWorktree('/repo', { path: '/wt/x', branch: 'feat', baseRef: 'nope' }),
      ).resolves.toEqual({
        ok: false,
        code: 'base-ref-not-found',
        message: 'Base ref "nope" could not be resolved.',
      })
    })

    it('maps an existing worktree path to worktree-exists', async () => {
      runGitMock
        .mockResolvedValueOnce(gitResult(0))
        .mockResolvedValueOnce(gitResult(128, '', "fatal: '/wt/x' already exists"))
      await expect(
        createGitWorktree('/repo', { path: '/wt/x', branch: 'feat', baseRef: 'main' }),
      ).resolves.toMatchObject({ ok: false, code: 'worktree-exists' })
    })
  })

  describe('removeGitWorktree', () => {
    it('removes without --force by default', async () => {
      await expect(removeGitWorktree('/repo', { path: '/wt/x' })).resolves.toEqual({
        ok: true,
        message: 'Worktree removed.',
        path: '/wt/x',
      })
      expect(runGitMock).toHaveBeenCalledWith('/repo', ['worktree', 'remove', '/wt/x'])
    })

    it('passes --force only when explicitly requested', async () => {
      await removeGitWorktree('/repo', { path: '/wt/x', force: true })
      expect(runGitMock).toHaveBeenCalledWith('/repo', ['worktree', 'remove', '/wt/x', '--force'])
    })

    it('maps git dirty refusal to dirty-worktree', async () => {
      runGitMock.mockResolvedValueOnce(
        gitResult(128, '', "fatal: '/wt/x' contains modified or untracked files, use --force"),
      )
      await expect(removeGitWorktree('/repo', { path: '/wt/x' })).resolves.toMatchObject({
        ok: false,
        code: 'dirty-worktree',
      })
    })
  })

  describe('parseWorktreeList / listGitWorktrees', () => {
    it('parses porcelain -z output including main and detached worktrees', () => {
      const stdout =
        'worktree /repo\0HEAD abc123\0branch refs/heads/main\0\0' +
        'worktree /wt/x\0HEAD def456\0branch refs/heads/feat\0\0' +
        'worktree /wt/y\0HEAD ghi789\0detached\0\0'
      expect(parseWorktreeList(stdout)).toEqual([
        { path: '/repo', head: 'abc123', branch: 'main', isMain: true },
        { path: '/wt/x', head: 'def456', branch: 'feat', isMain: false },
        { path: '/wt/y', head: 'ghi789', branch: null, isMain: false },
      ])
    })

    it('returns empty list for non-git repositories', async () => {
      isGitRepositoryMock.mockResolvedValue(false)
      await expect(listGitWorktrees('/repo')).resolves.toEqual({ worktrees: [] })
    })
  })
})

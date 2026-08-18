import { beforeEach, describe, expect, it, vi } from 'vitest'

const runGitMock = vi.fn()
const isGitRepositoryMock = vi.fn()

vi.mock('../shared', () => ({
  isGitRepository: (projectPath: string) => isGitRepositoryMock(projectPath),
  runGit: (projectPath: string, args: readonly string[], options?: unknown) =>
    runGitMock(projectPath, args, options),
  stripSurroundingQuotes: (value: string) => value,
}))

import { getGitBranchDiff, getGitDiff } from '../status-service'

function gitResult(code: number, stdout = '', stderr = '') {
  return { code, stdout, stderr }
}

/**
 * Loading a diff fails for ordinary reasons -- a folder that is not a repository, a
 * base ref the user typed that no longer resolves. These assert those arrive as
 * typed results, so callers branch on `ok` rather than wrapping every call in
 * try/catch (#152).
 */
describe('diff loading returns typed results', () => {
  beforeEach(() => {
    runGitMock.mockReset()
    isGitRepositoryMock.mockReset()
  })

  it('reports a non-repository folder instead of throwing', async () => {
    isGitRepositoryMock.mockResolvedValue(false)

    await expect(getGitDiff('/not/a/repo')).resolves.toEqual({
      ok: false,
      code: 'not-git-repo',
      message: 'Selected folder is not a Git repository.',
    })
    await expect(getGitBranchDiff('/not/a/repo', 'main')).resolves.toEqual({
      ok: false,
      code: 'not-git-repo',
      message: 'Selected folder is not a Git repository.',
    })
    expect(runGitMock).not.toHaveBeenCalled()
  })

  it('reports an unresolvable base ref as bad-revision', async () => {
    isGitRepositoryMock.mockResolvedValue(true)
    runGitMock.mockResolvedValue(gitResult(128, '', 'fatal: Needed a single revision'))

    await expect(getGitBranchDiff('/repo', 'gone')).resolves.toEqual({
      ok: false,
      code: 'bad-revision',
      message: 'Base ref "gone" could not be resolved.',
    })
  })

  it('reports a failing diff command as unknown, carrying git stderr', async () => {
    isGitRepositoryMock.mockResolvedValue(true)
    runGitMock
      .mockResolvedValueOnce(gitResult(0)) // rev-parse --verify base^{commit}
      .mockResolvedValueOnce(gitResult(1, '', 'fatal: bad object'))

    await expect(getGitBranchDiff('/repo', 'main')).resolves.toEqual({
      ok: false,
      code: 'unknown',
      message: 'fatal: bad object',
    })
  })

  it('returns parsed files on success', async () => {
    isGitRepositoryMock.mockResolvedValue(true)
    const patch = [
      'diff --git a/a.ts b/a.ts',
      '--- a/a.ts',
      '+++ b/a.ts',
      '@@ -1 +1 @@',
      '-old',
      '+new',
    ].join('\n')
    runGitMock.mockResolvedValueOnce(gitResult(0)).mockResolvedValueOnce(gitResult(0, patch))

    const result = await getGitBranchDiff('/repo', 'main')

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected success')
    expect(result.files).toHaveLength(1)
    expect(result.files[0]?.path).toBe('a.ts')
  })

  it('treats an empty base ref as the working-tree diff', async () => {
    isGitRepositoryMock.mockResolvedValue(true)
    runGitMock.mockResolvedValue(gitResult(0, ''))

    const result = await getGitBranchDiff('/repo', '   ')

    expect(result).toEqual({ ok: true, files: [] })
    // rev-parse --verify HEAD, not a three-dot diff against a base.
    expect(runGitMock.mock.calls[0]?.[1]).toEqual(['rev-parse', '--verify', 'HEAD'])
  })
})

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

  it('resolves an empty base ref to the default branch before diffing', async () => {
    isGitRepositoryMock.mockResolvedValue(true)
    runGitMock.mockImplementation((_path: string, args: readonly string[]) => {
      if (args[0] === 'symbolic-ref') return Promise.resolve(gitResult(0, 'origin/main\n'))
      if (args[0] === 'rev-parse') return Promise.resolve(gitResult(0, 'abc123\n'))
      return Promise.resolve(gitResult(0, ''))
    })

    const result = await getGitBranchDiff('/repo', '   ')

    expect(result).toEqual({ ok: true, files: [] })
    // A three-dot diff against the resolved default branch, not the working-tree diff.
    const diffCall = runGitMock.mock.calls.find((call) => call[1]?.[0] === 'diff')
    expect(diffCall?.[1]).toEqual([
      'diff',
      '--patch',
      '--find-renames',
      '--no-ext-diff',
      'origin/main...HEAD',
    ])
  })

  it('falls back to the working-tree diff when no default branch resolves', async () => {
    isGitRepositoryMock.mockResolvedValue(true)
    // Nothing advertises a default branch: no origin/HEAD and no init.defaultBranch.
    runGitMock.mockResolvedValue(gitResult(0, ''))

    const result = await getGitBranchDiff('/repo', '   ')

    expect(result).toEqual({ ok: true, files: [] })
    // The working-tree path also shells out to `git diff`, so assert on the three-dot form:
    // no `<ref>...HEAD` range means no branch comparison was attempted.
    expect(
      runGitMock.mock.calls.some((call) => call[1]?.some((arg: string) => arg.endsWith('...HEAD'))),
    ).toBe(false)
    expect(
      runGitMock.mock.calls.some((call) => call[1]?.[0] === 'rev-parse' && call[1]?.[2] === 'HEAD'),
    ).toBe(true)
  })
})

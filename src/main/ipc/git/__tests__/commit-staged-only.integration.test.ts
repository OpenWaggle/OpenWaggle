import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { createRepositoryWithWorktree, git } from './commit.test-harness'

const { commitGit } = await import('../commit-handler')
const { getGitStatus } = await import('../status-service')

describe('commitGit staged-only mode', () => {
  it('reports exact unstaged line stats for files inside an untracked directory', async () => {
    const { worktree } = await createRepositoryWithWorktree()
    await mkdir(path.join(worktree, 'new'), { recursive: true })
    await writeFile(path.join(worktree, 'new', 'notes.txt'), 'first\nsecond\n')

    const status = await getGitStatus(worktree)

    expect(status.unstagedChanges).toEqual({ filesChanged: 1, additions: 2, deletions: 0 })
    expect(status.changedFiles).toEqual([
      expect.objectContaining({
        path: 'new/notes.txt',
        status: 'untracked',
        staged: false,
        unstaged: true,
        additions: 2,
        deletions: 0,
      }),
    ])
  })

  it('keeps untracked paths repository-relative when the project opens a subdirectory', async () => {
    const { worktree } = await createRepositoryWithWorktree()
    const openedDirectory = path.join(worktree, 'packages', 'app')
    await mkdir(openedDirectory, { recursive: true })
    await writeFile(path.join(worktree, 'notes.txt'), 'root should remain untracked\n')
    await writeFile(path.join(openedDirectory, 'notes.txt'), 'nested one\nnested two\n')

    const status = await getGitStatus(openedDirectory)

    expect(status.changedFiles).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: 'notes.txt', status: 'untracked', additions: 1 }),
        expect.objectContaining({
          path: 'packages/app/notes.txt',
          status: 'untracked',
          additions: 2,
        }),
      ]),
    )

    const result = await commitGit(openedDirectory, {
      message: 'Commit the nested file only',
      amend: false,
      paths: ['packages/app/notes.txt'],
      includeUnstaged: true,
    })

    expect(result.ok).toBe(true)
    expect(await git(worktree, ['show', 'HEAD:packages/app/notes.txt'])).toBe(
      'nested one\nnested two\n',
    )
    expect(await git(worktree, ['ls-files', '--others', '--exclude-standard'])).toBe('notes.txt\n')
  })

  it('commits the current index and leaves a partially staged file working-tree hunk untouched', async () => {
    const { worktree } = await createRepositoryWithWorktree()
    const filePath = path.join(worktree, 'partial.txt')
    await writeFile(filePath, 'base\n')
    await git(worktree, ['add', 'partial.txt'])
    await git(worktree, ['commit', '-m', 'Add partial fixture'])
    await writeFile(filePath, 'base\nstaged\n')
    await git(worktree, ['add', 'partial.txt'])
    await writeFile(filePath, 'base\nstaged\nunstaged\n')

    const beforeCommit = await getGitStatus(worktree)
    expect(beforeCommit.stagedChanges).toEqual({ filesChanged: 1, additions: 1, deletions: 0 })
    expect(beforeCommit.unstagedChanges).toEqual({ filesChanged: 1, additions: 1, deletions: 0 })

    const result = await commitGit(worktree, {
      message: 'Commit only the index',
      amend: false,
      paths: ['partial.txt'],
      includeUnstaged: false,
    })

    expect(result.ok).toBe(true)
    expect(await git(worktree, ['show', 'HEAD:partial.txt'])).toBe('base\nstaged\n')
    expect(await readFile(filePath, 'utf8')).toBe('base\nstaged\nunstaged\n')
    expect(await git(worktree, ['diff', '--', 'partial.txt'])).toContain('+unstaged')
    expect(await git(worktree, ['diff', '--cached', '--', 'partial.txt'])).toBe('')
  })
})

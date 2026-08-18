import { execFile } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'
import { DIFF_GIT_MAX_BUFFER } from '../status-constants'
import { getGitDiff } from '../status-service'

const execFileAsync = promisify(execFile)
let repositoryPath: string | null = null

/** Enough padding to push `git diff` output past the diff buffer. */
const PADDING_LINE = 'line of text padding padding padding padding padding\n'
const LINES_OVER_BUFFER = Math.ceil((DIFF_GIT_MAX_BUFFER * 2) / PADDING_LINE.length)

async function git(cwd: string, args: readonly string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', [...args], { cwd })
  return stdout
}

async function createRepository(): Promise<string> {
  const repository = await mkdtemp(path.join(tmpdir(), 'openwaggle-diff-failure-'))
  repositoryPath = repository
  await git(repository, ['init', '--initial-branch=main'])
  await git(repository, ['config', 'user.name', 'OpenWaggle Test'])
  await git(repository, ['config', 'user.email', 'openwaggle@example.test'])
  await writeFile(path.join(repository, 'big.txt'), 'seed\n')
  await git(repository, ['add', '--all'])
  await git(repository, ['commit', '-m', 'Initial commit'])
  return repository
}

afterEach(async () => {
  if (repositoryPath) await rm(repositoryPath, { recursive: true, force: true })
  repositoryPath = null
})

describe('getGitDiff failures', () => {
  it('returns a typed diff-too-large failure instead of throwing', async () => {
    /*
     * The working-tree diff path used to throw for every failure except "not a repo", so the
     * renderer got a raw IPC rejection where the branch-diff path returned a typed failure for
     * the same condition. An ordinary large change is enough: git's output exceeding the buffer
     * is reported by Node with a non-numeric error code, which normalises to `code: 1` with an
     * empty stderr, so the thrown message could not even say what went wrong.
     */
    const repository = await createRepository()
    await writeFile(path.join(repository, 'big.txt'), PADDING_LINE.repeat(LINES_OVER_BUFFER))

    const result = await getGitDiff(repository)

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected the oversized diff to fail')
    expect(result.code).toBe('diff-too-large')
    expect(result.message).toContain('too large')
  })

  it('still returns changed files for a diff that fits', async () => {
    const repository = await createRepository()
    await writeFile(path.join(repository, 'big.txt'), 'seed\nsecond line\n')

    const result = await getGitDiff(repository)

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected an ordinary diff to succeed')
    expect(result.files.map((file) => file.path)).toEqual(['big.txt'])
  })

  it('reports an unborn-HEAD repository without throwing', async () => {
    const repository = await mkdtemp(path.join(tmpdir(), 'openwaggle-diff-unborn-'))
    repositoryPath = repository
    await git(repository, ['init', '--initial-branch=main'])
    await writeFile(path.join(repository, 'new.txt'), 'content\n')
    await git(repository, ['add', '--all'])

    const result = await getGitDiff(repository)

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected the initial-commit path to succeed')
    expect(result.files.map((file) => file.path)).toEqual(['new.txt'])
  })
})

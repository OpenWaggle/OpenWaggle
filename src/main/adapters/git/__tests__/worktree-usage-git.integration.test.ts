import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  checkoutTopLevel,
  countUncommittedChanges,
  countUnpublishedCommits,
} from '../worktree-usage-git'

const execFileAsync = promisify(execFile)
const IDENTITY = ['-c', 'user.name=OpenWaggle Test', '-c', 'user.email=test@openwaggle.local']
const REAL_GIT_TEST_TIMEOUT_MS = 60_000

async function git(cwd: string, args: readonly string[]) {
  return (await execFileAsync('git', [...IDENTITY, ...args], { cwd })).stdout.trim()
}

let root = ''
beforeEach(async () => {
  root = await realpath(await mkdtemp(path.join(tmpdir(), 'openwaggle-worktree-usage-')))
})
afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('the Git facts behind a worktree removal confirmation', () => {
  it('counts only the commits no remote has', { timeout: REAL_GIT_TEST_TIMEOUT_MS }, async () => {
    const remote = path.join(root, 'remote.git')
    const work = path.join(root, 'work')
    await git(root, ['init', '--quiet', '--bare', '-b', 'main', remote])
    await git(root, ['clone', '--quiet', remote, work])
    await writeFile(path.join(work, 'a.txt'), 'a\n')
    await git(work, ['add', '--all'])
    await git(work, ['commit', '-m', 'published'])
    await git(work, ['push', '--quiet', 'origin', 'main'])
    const worktree = path.join(root, 'session')
    await git(work, ['worktree', 'add', '--quiet', '--no-track', '-b', 'ow/x', worktree, 'main'])

    expect(await countUnpublishedCommits(worktree)).toBe(0)

    for (const name of ['b', 'c']) {
      await writeFile(path.join(worktree, `${name}.txt`), `${name}\n`)
      await git(worktree, ['add', '--all'])
      await git(worktree, ['commit', '-m', name])
    }
    expect(await countUnpublishedCommits(worktree)).toBe(2)

    await git(worktree, ['push', '--quiet', 'origin', 'ow/x'])
    expect(await countUnpublishedCommits(worktree)).toBe(0)
  })

  it('counts changes, renames and untracked files whatever the status settings', {
    timeout: REAL_GIT_TEST_TIMEOUT_MS,
  }, async () => {
    const work = path.join(root, 'work')
    await mkdir(work)
    await git(work, ['init', '--quiet', '-b', 'main'])
    await writeFile(path.join(work, 'a.txt'), 'a\n')
    await writeFile(path.join(work, 'b.txt'), 'b\n')
    await writeFile(path.join(work, '.gitignore'), 'ignored.txt\n')
    await git(work, ['add', '--all'])
    await git(work, ['commit', '-m', 'init'])
    expect(await countUncommittedChanges(work)).toBe(0)

    // A setting that hides untracked files must not make a new file look safe to delete.
    await git(work, ['config', 'status.showUntrackedFiles', 'no'])
    await writeFile(path.join(work, 'new.txt'), 'new\n')
    await writeFile(path.join(work, 'ignored.txt'), 'ignored\n')
    expect(await countUncommittedChanges(work)).toBe(1)

    // A staged rename is one entry with its source as an extra field.
    await git(work, ['mv', 'a.txt', 'renamed.txt'])
    await writeFile(path.join(work, 'b.txt'), 'changed\n')
    expect(await countUncommittedChanges(work)).toBe(3)
  })

  it('resolves the checkout a folder lives in', { timeout: REAL_GIT_TEST_TIMEOUT_MS }, async () => {
    const work = path.join(root, 'work')
    await mkdir(path.join(work, 'nested', 'deeper'), { recursive: true })
    await git(work, ['init', '--quiet', '-b', 'main'])

    expect(await checkoutTopLevel(path.join(work, 'nested', 'deeper'))).toBe(work)
    expect(await checkoutTopLevel(root)).toBeNull()
  })
})

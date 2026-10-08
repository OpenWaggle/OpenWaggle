import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { projectSettingsKey } from '../project-root'

function git(cwd: string, ...args: string[]) {
  execFileSync('git', args, { cwd, stdio: 'ignore' })
}

let root: string

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'ow-project-root-')))
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

function commit(cwd: string) {
  git(cwd, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '--allow-empty', '-qm', 'init')
}

describe('the key per-project source-control settings are stored under', () => {
  it('is the main checkout for the checkout, its subfolders, and its worktrees', async () => {
    const main = join(root, 'app')
    git(root, 'init', '--quiet', main)
    commit(main)
    mkdirSync(join(main, 'packages'))
    git(main, 'worktree', 'add', '--quiet', join(root, 'feature'))

    await expect(projectSettingsKey(main)).resolves.toBe(main)
    await expect(projectSettingsKey(join(main, 'packages'))).resolves.toBe(main)
    await expect(projectSettingsKey(join(root, 'feature'))).resolves.toBe(main)
  })

  it('is the work tree itself for a worktree of a bare repository', async () => {
    const bare = join(root, 'app.git')
    const seed = join(root, 'seed')
    git(root, 'init', '--quiet', seed)
    commit(seed)
    git(root, 'clone', '--quiet', '--bare', seed, bare)
    git(bare, 'worktree', 'add', '--quiet', join(root, 'work'))

    await expect(projectSettingsKey(join(root, 'work'))).resolves.toBe(join(root, 'work'))
  })
})

import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, expect, it } from 'vitest'
import { listGitWorktrees, removeGitWorktree, validateGitWorktreeRemoval } from '../worktree'

const execFileAsync = promisify(execFile)
let temporaryRoot: string | null = null

afterEach(async () => {
  if (temporaryRoot) await rm(temporaryRoot, { recursive: true, force: true })
  temporaryRoot = null
})

it('rejects a clean Git-locked worktree before removal side effects', async () => {
  temporaryRoot = await realpath(await mkdtemp(join(tmpdir(), 'openwaggle-locked-worktree-')))
  const projectPath = join(temporaryRoot, 'project')
  const worktreePath = join(temporaryRoot, 'worktree')
  await mkdir(projectPath)
  await execFileAsync('git', ['-C', projectPath, 'init', '-q'])
  await writeFile(join(projectPath, 'README.md'), 'initial\n')
  await execFileAsync('git', ['-C', projectPath, 'add', 'README.md'])
  await execFileAsync('git', [
    '-C',
    projectPath,
    '-c',
    'user.name=OpenWaggle Test',
    '-c',
    'user.email=test@openwaggle.invalid',
    'commit',
    '-qm',
    'initial',
  ])
  await execFileAsync('git', [
    '-C',
    projectPath,
    'worktree',
    'add',
    '-qb',
    'test-worktree',
    worktreePath,
  ])
  await execFileAsync('git', [
    '-C',
    projectPath,
    'worktree',
    'lock',
    '--reason',
    'active session',
    worktreePath,
  ])

  const listed = await listGitWorktrees(projectPath)
  expect(listed.worktrees.find((worktree) => worktree.path === worktreePath)?.locked).toBe(true)
  await expect(
    validateGitWorktreeRemoval(projectPath, { path: worktreePath }),
  ).resolves.toMatchObject({
    ok: false,
    message: expect.stringContaining('locked'),
  })
  expect(existsSync(worktreePath)).toBe(true)
  // Overriding only the lock still refuses uncommitted work, and admits a clean worktree.
  const lockOnly = { path: worktreePath, force: true, lockOnly: true }
  await writeFile(join(worktreePath, 'draft.txt'), 'unsaved\n')
  await expect(validateGitWorktreeRemoval(projectPath, lockOnly)).resolves.toMatchObject({
    ok: false,
    code: 'dirty-worktree',
  })
  // The removal itself refuses too, whoever calls it without the validation.
  await expect(removeGitWorktree(projectPath, lockOnly)).resolves.toMatchObject({
    ok: false,
    code: 'dirty-worktree',
  })
  expect(existsSync(join(worktreePath, 'draft.txt'))).toBe(true)
  await rm(join(worktreePath, 'draft.txt'))
  await expect(validateGitWorktreeRemoval(projectPath, lockOnly)).resolves.toMatchObject({
    ok: true,
  })
  await expect(
    validateGitWorktreeRemoval(projectPath, { path: worktreePath, force: true }),
  ).resolves.toMatchObject({ ok: true })
  await expect(
    removeGitWorktree(projectPath, { path: worktreePath, force: true }),
  ).resolves.toMatchObject({
    ok: true,
  })
  expect(existsSync(worktreePath)).toBe(false)
})

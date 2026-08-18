import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { turnCheckpointRef } from '@shared/utils/turn-checkpoint-ref'
import { afterEach, describe, expect, it } from 'vitest'
import { execFileAsync } from '../../../../ipc/git/shared'
import { captureWorktreeSnapshotForTests } from '../turn-capture'

let projectPath: string | null = null

async function git(args: readonly string[]): Promise<string> {
  if (!projectPath) throw new Error('Temporary Git repository is not initialized.')
  const result = await execFileAsync('git', args, { cwd: projectPath })
  return typeof result === 'string' ? result : (result.stdout ?? '')
}

async function createRepository(): Promise<string> {
  projectPath = await mkdtemp(path.join(tmpdir(), 'openwaggle-turn-capture-'))
  await git(['init'])
  await git(['config', 'user.name', 'OpenWaggle Test'])
  await git(['config', 'user.email', 'openwaggle@example.test'])
  await writeFile(path.join(projectPath, 'tracked.txt'), 'before\n')
  await writeFile(path.join(projectPath, '.gitignore'), 'ignored.log\n')
  await git(['add', '--all'])
  await git(['commit', '-m', 'Initial commit'])
  return projectPath
}

afterEach(async () => {
  if (projectPath) await rm(projectPath, { recursive: true, force: true })
  projectPath = null
})

describe('turn checkpoint worktree snapshot', () => {
  it('includes untracked files (the common agent output) in the snapshot', async () => {
    const repo = await createRepository()
    await writeFile(path.join(repo, 'brand-new.ts'), 'export const created = true\n')

    const snapshot = await captureWorktreeSnapshotForTests(repo)
    expect(snapshot).toBeTruthy()

    const diff = await git(['diff', 'HEAD', String(snapshot)])
    expect(diff).toContain('brand-new.ts')
    expect(diff).toContain('export const created = true')
  })

  it('includes tracked modifications and deletions', async () => {
    const repo = await createRepository()
    await writeFile(path.join(repo, 'tracked.txt'), 'after\n')

    const snapshot = await captureWorktreeSnapshotForTests(repo)
    const diff = await git(['diff', 'HEAD', String(snapshot)])
    expect(diff).toContain('tracked.txt')
    expect(diff).toContain('+after')
  })

  it('respects .gitignore (ignored files are not snapshotted)', async () => {
    const repo = await createRepository()
    await writeFile(path.join(repo, 'ignored.log'), 'noise\n')
    await writeFile(path.join(repo, 'real.txt'), 'real\n')

    const snapshot = await captureWorktreeSnapshotForTests(repo)
    const diff = await git(['diff', 'HEAD', String(snapshot)])
    expect(diff).toContain('real.txt')
    expect(diff).not.toContain('ignored.log')
  })

  it('does not mutate the real index or working tree', async () => {
    const repo = await createRepository()
    await writeFile(path.join(repo, 'brand-new.ts'), 'x\n')

    await captureWorktreeSnapshotForTests(repo)

    // brand-new.ts must still be untracked, and nothing staged.
    const status = await git(['status', '--porcelain=v1'])
    expect(status).toContain('?? brand-new.ts')
    const staged = await git(['diff', '--cached', '--name-only'])
    expect(staged.trim()).toBe('')
  })

  it('returns null when the worktree matches HEAD', async () => {
    const repo = await createRepository()
    await expect(captureWorktreeSnapshotForTests(repo)).resolves.toBeNull()
  })

  it('anchors a snapshot under a reachable ref so it survives gc', async () => {
    const repo = await createRepository()
    await writeFile(path.join(repo, 'brand-new.ts'), 'x\n')
    const snapshot = await captureWorktreeSnapshotForTests(repo)
    const ref = turnCheckpointRef('sess-1', 'run-1')
    await git(['update-ref', ref, String(snapshot)])

    await git(['gc', '--prune=now'])

    const resolved = await git(['rev-parse', '--verify', `${ref}^{commit}`])
    expect(resolved.trim()).toBe(String(snapshot))
  })
})

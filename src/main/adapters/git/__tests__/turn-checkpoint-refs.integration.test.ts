import { execFile } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { turnCheckpointRef } from '@shared/utils/turn-checkpoint-ref'
import { afterEach, describe, expect, it } from 'vitest'
import { deleteSessionTurnCheckpointRefs } from '../turn-checkpoint-refs'

const execFileAsync = promisify(execFile)
let repositoryPath: string | null = null

async function git(cwd: string, args: readonly string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', [...args], { cwd })
  return stdout
}

async function createRepository(): Promise<string> {
  const repository = await mkdtemp(path.join(tmpdir(), 'openwaggle-checkpoint-refs-'))
  repositoryPath = repository
  await git(repository, ['init', '--initial-branch=main'])
  await git(repository, ['config', 'user.name', 'OpenWaggle Test'])
  await git(repository, ['config', 'user.email', 'openwaggle@example.test'])
  await writeFile(path.join(repository, 'seed.txt'), 'seed\n')
  await git(repository, ['add', '--all'])
  await git(repository, ['commit', '-m', 'Initial commit'])
  return repository
}

async function listOpenWaggleRefs(repository: string): Promise<readonly string[]> {
  const stdout = await git(repository, ['for-each-ref', '--format=%(refname)', 'refs/openwaggle'])
  return stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
}

afterEach(async () => {
  if (repositoryPath) await rm(repositoryPath, { recursive: true, force: true })
  repositoryPath = null
})

describe('deleteSessionTurnCheckpointRefs', () => {
  it("removes a session's anchor refs so its snapshot objects stop being reachable", async () => {
    /*
     * Anchor refs kept turn snapshots gc-safe on purpose, but the session death path only
     * deleted DB rows. Verified against real git that a ref in this namespace survives worktree
     * removal, branch deletion and `git gc --prune=now`, so every snapshot ever captured stayed
     * permanently reachable in the user's repository: unbounded .git growth with no way back.
     */
    const repository = await createRepository()
    const head = (await git(repository, ['rev-parse', 'HEAD'])).trim()
    await git(repository, ['update-ref', turnCheckpointRef('sess-doomed', 'turn-1'), head])
    await git(repository, ['update-ref', turnCheckpointRef('sess-doomed', 'turn-2'), head])
    await git(repository, ['update-ref', turnCheckpointRef('sess-keeper', 'turn-1'), head])

    await deleteSessionTurnCheckpointRefs(repository, 'sess-doomed')

    // Only the dead session's refs go; a live session's anchors must survive.
    expect(await listOpenWaggleRefs(repository)).toEqual([
      turnCheckpointRef('sess-keeper', 'turn-1'),
    ])
  })

  it('collects refs whose checkpoint rows were already pruned', async () => {
    // Deletes the namespace rather than a list of turn ids, so retention-pruned or
    // never-recorded refs cannot be left behind.
    const repository = await createRepository()
    const head = (await git(repository, ['rev-parse', 'HEAD'])).trim()
    await git(repository, ['update-ref', turnCheckpointRef('sess-1', 'unknown-turn'), head])

    await deleteSessionTurnCheckpointRefs(repository, 'sess-1')

    expect(await listOpenWaggleRefs(repository)).toEqual([])
  })

  it('does nothing when the session never captured a checkpoint', async () => {
    const repository = await createRepository()
    await expect(
      deleteSessionTurnCheckpointRefs(repository, 'sess-never-ran'),
    ).resolves.toBeUndefined()
  })
})

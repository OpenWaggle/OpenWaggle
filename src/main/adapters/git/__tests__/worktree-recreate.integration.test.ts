import { execFile } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'
import { createGitWorktree } from '../worktree'

const execFileAsync = promisify(execFile)

let repositoryPath: string | null = null
const createdWorktrees: string[] = []

async function git(cwd: string, args: readonly string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', [...args], { cwd })
  return stdout
}

async function createRepository(): Promise<string> {
  const repository = await mkdtemp(path.join(tmpdir(), 'openwaggle-worktree-recreate-'))
  repositoryPath = repository
  await git(repository, ['init', '--initial-branch=main'])
  await git(repository, ['config', 'user.name', 'OpenWaggle Test'])
  await git(repository, ['config', 'user.email', 'openwaggle@example.test'])
  await writeFile(path.join(repository, 'seed.txt'), 'seed\n')
  await git(repository, ['add', '--all'])
  await git(repository, ['commit', '-m', 'Initial commit'])
  return repository
}

function worktreePathFor(repository: string, name: string) {
  const target = path.join(path.dirname(repository), `${path.basename(repository)}-${name}`)
  createdWorktrees.push(target)
  return target
}

afterEach(async () => {
  for (const worktree of createdWorktrees) {
    if (repositoryPath !== null) {
      await git(repositoryPath, ['worktree', 'remove', '--force', worktree]).catch(() => undefined)
    }
    await rm(worktree, { recursive: true, force: true }).catch(() => undefined)
  }
  createdWorktrees.length = 0
  if (repositoryPath !== null) await rm(repositoryPath, { recursive: true, force: true })
  repositoryPath = null
})

describe('createGitWorktree recreation against real Git', () => {
  /**
   * The blocking defect this pins, and the reason it is an integration test rather than a
   * unit test: `git worktree prune` clears the stale registration but leaves the branch
   * behind, so `worktree add -b <branch>` fails with "a branch named ... already exists".
   * A session whose worktree directory was deleted out-of-band could therefore never run
   * again.
   *
   * That behaviour of prune is a property of Git, not of our code, so mocked-git unit
   * tests asserted the intent while the real path stayed broken. Only real Git can show
   * this.
   */
  it('recreates a worktree whose directory was deleted while its branch survived', async () => {
    const repository = await createRepository()
    const worktree = worktreePathFor(repository, 'session')
    const branch = 'ow/session-abcd1234'

    const first = await createGitWorktree(repository, { path: worktree, branch, baseRef: 'main' })
    expect(first.ok).toBe(true)

    // The agent commits inside its worktree, then the directory vanishes out-of-band.
    await writeFile(path.join(worktree, 'agent.txt'), 'agent work\n')
    await git(worktree, ['add', '--all'])
    await git(worktree, ['commit', '-m', 'agent work'])
    const survivingHead = (await git(worktree, ['rev-parse', 'HEAD'])).trim()
    await rm(worktree, { recursive: true, force: true })

    const second = await createGitWorktree(repository, { path: worktree, branch, baseRef: 'main' })

    expect(second.ok).toBe(true)
    expect((await git(repository, ['rev-parse', branch])).trim()).toBe(survivingHead)
  })

  /**
   * Recreation must ATTACH to the surviving branch, not start a fresh one from the base
   * ref. Reproduced in the running app before this was pinned: a divergent branch was
   * created and the session's commit was left stranded on the orphaned original, which is
   * silent loss of the agent's work.
   */
  it('preserves commits made in the vanished worktree', async () => {
    const repository = await createRepository()
    const worktree = worktreePathFor(repository, 'preserve')
    const branch = 'ow/session-preserve'

    await createGitWorktree(repository, { path: worktree, branch, baseRef: 'main' })
    await writeFile(path.join(worktree, 'precious.txt'), 'precious\n')
    await git(worktree, ['add', '--all'])
    await git(worktree, ['commit', '-m', 'precious agent work'])
    await rm(worktree, { recursive: true, force: true })

    await createGitWorktree(repository, { path: worktree, branch, baseRef: 'main' })

    expect((await git(worktree, ['rev-parse', '--abbrev-ref', 'HEAD'])).trim()).toBe(branch)
    expect(await git(worktree, ['log', '--pretty=%s'])).toContain('precious agent work')
    expect(await git(worktree, ['ls-files'])).toContain('precious.txt')
  })

  it('creates the branch when no worktree has ever existed for it', async () => {
    const repository = await createRepository()
    const worktree = worktreePathFor(repository, 'fresh')

    const result = await createGitWorktree(repository, {
      path: worktree,
      branch: 'ow/session-fresh',
      baseRef: 'main',
    })

    expect(result.ok).toBe(true)
    expect((await git(worktree, ['rev-parse', '--abbrev-ref', 'HEAD'])).trim()).toBe(
      'ow/session-fresh',
    )
  })
})

describe('session worktree branch collisions', () => {
  it('refuses to attach a branch that another worktree already has checked out', async () => {
    /*
     * Two sessions must never share a branch. They used to: the branch was named from the
     * first 8 characters of the session id, and those are the top bits of a UUIDv7 timestamp,
     * so sessions created within ~65s of each other derived the same name. Attaching then
     * either failed with a misleading `unknown` code or, once the first worktree had been
     * removed while its branch survived, silently handed the second session the first
     * session's commits.
     */
    const repository = await createRepository()
    const first = worktreePathFor(repository, 'session-first')
    const second = worktreePathFor(repository, 'session-second')
    const sharedBranch = 'ow/session-shared'

    const created = await createGitWorktree(repository, {
      path: first,
      branch: sharedBranch,
      baseRef: 'main',
    })
    expect(created.ok).toBe(true)

    const collided = await createGitWorktree(repository, {
      path: second,
      branch: sharedBranch,
      baseRef: 'main',
    })

    expect(collided.ok).toBe(false)
    if (collided.ok) throw new Error('expected the collision to be refused')
    expect(collided.code).toBe('branch-checked-out-elsewhere')
    expect(collided.message).toContain(first)
  })
})

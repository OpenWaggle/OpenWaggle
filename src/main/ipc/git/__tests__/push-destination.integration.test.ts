import { execFile as execFileCallback } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: { getPath: () => tmpdir(), getName: () => 'openwaggle-test' },
  BrowserWindow: { getAllWindows: () => [] },
  ipcMain: { handle: vi.fn(), on: vi.fn() },
}))

const { pushCurrentBranch } = await import('../push-service')
const { getLocalVcsStatus } = await import('../vcs-status-service')

const execFile = promisify(execFileCallback)
const IDENTITY = [
  '-c',
  'user.name=OpenWaggle Tests',
  '-c',
  'user.email=tests@openwaggle.ai',
] as const

let workspace: string | null = null

afterEach(async () => {
  if (workspace) await rm(workspace, { force: true, recursive: true })
  workspace = null
})

async function git(cwd: string, args: readonly string[]) {
  const { stdout } = await execFile('git', [...IDENTITY, ...args], { cwd })
  return stdout.trim()
}

/**
 * A clone on `feature`, deliberately tracking `origin/main`, with `push.default=upstream`.
 *
 * This is the shape that matters: a bare `git push` writes the *upstream's* branch, so it lands on `main` while
 * the user is standing on `feature`. Verified against real git, which reported `feature -> main`.
 */
async function repositoryTrackingMain() {
  const root = await mkdtemp(path.join(tmpdir(), 'openwaggle-push-'))
  workspace = root
  const remote = path.join(root, 'remote')
  const work = path.join(root, 'work')
  await git(root, ['init', '--quiet', '--bare', '-b', 'main', remote])
  await git(root, ['clone', '--quiet', remote, work])
  await writeFile(path.join(work, 'a.txt'), 'base\n')
  await git(work, ['add', '--all'])
  await git(work, ['commit', '-m', 'base'])
  await git(work, ['push', '--quiet', '-u', 'origin', 'main'])
  /*
   * Records `refs/remotes/origin/HEAD`, which is what a real clone of a non-empty repository has. Without it the
   * default branch is unknown and every ref counts as the default by the fail-closed rule, which would make this
   * fixture prove nothing about the destination.
   */
  await git(work, ['remote', 'set-head', 'origin', 'main'])
  await git(work, ['checkout', '--quiet', '-b', 'feature'])
  await writeFile(path.join(work, 'b.txt'), 'feature\n')
  await git(work, ['add', '--all'])
  await git(work, ['commit', '-m', 'feature work'])
  await git(work, ['branch', '--set-upstream-to=origin/main', 'feature'])
  /*
   * `current` rather than `upstream`, because it is the setting that makes the two forms differ: a bare
   * `git push` writes `origin/feature` while the upstream the app resolved - and the confirmation was shown for -
   * is `origin/main`. Verified against real git, which created a new `feature` branch on the remote.
   */
  await git(work, ['config', 'push.default', 'current'])
  return { remote, work }
}

async function repositoryWithUpstreamOnly() {
  const root = await mkdtemp(path.join(tmpdir(), 'openwaggle-first-push-'))
  workspace = root
  const remote = path.join(root, 'remote')
  const work = path.join(root, 'work')
  await git(root, ['init', '--quiet', '--bare', '-b', 'main', remote])
  await git(root, ['clone', '--quiet', remote, work])
  await writeFile(path.join(work, 'a.txt'), 'base\n')
  await git(work, ['add', '--all'])
  await git(work, ['commit', '-m', 'base'])
  await git(work, ['push', '--quiet', '-u', 'origin', 'main'])
  await git(work, ['remote', 'rename', 'origin', 'upstream'])
  await git(work, ['checkout', '--quiet', '-b', 'feature'])
  await writeFile(path.join(work, 'b.txt'), 'feature\n')
  await git(work, ['add', '--all'])
  await git(work, ['commit', '-m', 'feature work'])
  return { remote, work }
}

describe('where a push lands', () => {
  it('reports the destination, not just the ref the user is on', async () => {
    /*
     * The confirmation before a push to the default branch judged only the current ref, so this state - on
     * `feature`, writing `main` - was waved straight through. The status now carries what a push would write.
     */
    const { work } = await repositoryTrackingMain()

    const result = await getLocalVcsStatus(work)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.status.refName).toBe('feature')
    expect(result.status.pushTargetRef).toBe('main')
    expect(result.status.isDefaultRef).toBe(false)
    expect(result.status.pushTargetIsDefaultRef).toBe(true)
  })

  it('pushes to the named upstream rather than leaving it to push.default', async () => {
    /*
     * The destination is named explicitly, so the same command cannot land somewhere else because of a setting
     * the app never sees. It is still the user's own mapping, so a branch deliberately tracking a
     * differently-named remote branch keeps working - which is what this asserts.
     */
    const { remote, work } = await repositoryTrackingMain()

    const result = await pushCurrentBranch(work)

    expect(result.ok).toBe(true)
    expect(result.message).toContain('origin/main')
    expect(await git(remote, ['log', '--format=%s', '-1', 'refs/heads/main'])).toBe('feature work')
    // A bare push would have created this instead of updating the upstream.
    await expect(git(remote, ['rev-parse', '--verify', 'refs/heads/feature'])).rejects.toThrow()
  })

  it('uses the selected non-origin remote for a branch first push', async () => {
    const { remote, work } = await repositoryWithUpstreamOnly()

    const result = await pushCurrentBranch(work)

    expect(result.ok).toBe(true)
    expect(result.message).toContain('upstream/feature')
    expect(await git(remote, ['log', '--format=%s', '-1', 'refs/heads/feature'])).toBe(
      'feature work',
    )
  })
})

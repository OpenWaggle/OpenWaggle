import { execFile as execFileCallback } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { fromPartial } from '@total-typescript/shoehorn'
import * as Effect from 'effect/Effect'
import type { IpcMainInvokeEvent } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: { getPath: () => tmpdir(), getName: () => 'openwaggle-test' },
  BrowserWindow: { getAllWindows: () => [] },
  ipcMain: { handle: vi.fn(), on: vi.fn() },
}))

const showMessageBox = vi.fn(async () => ({ response: 0, checkboxChecked: false }))
vi.mock('../../../desktop-ui', () => ({
  browserWindowFromWebContents: () => null,
  showMessageBox,
}))

const { confirmDefaultBranchAction, revalidateGitTarget } = await import(
  '../stacked-action-default-branch-gate'
)
const { createGitWorktree } = await import('../../../adapters/git/worktree')
const { pushCurrentBranch } = await import('../push-service')
const { getLocalVcsStatus } = await import('../vcs-status-service')

const execFile = promisify(execFileCallback)
const IDENTITY = [
  '-c',
  'user.name=OpenWaggle Tests',
  '-c',
  'user.email=tests@openwaggle.ai',
] as const
/** Each case runs a few dozen real Git commands, which the parallel integration tier slows down. */
const REAL_GIT_TEST_TIMEOUT_MS = 90_000
const BRANCH = 'ow/session-1234abcd'

/** `unset` is Git's built-in default (simple), with no push.default in any config file. */
const PUSH_DEFAULTS = ['unset', 'simple', 'current', 'upstream'] as const
type PushDefault = (typeof PUSH_DEFAULTS)[number]

let workspace: string | null = null

beforeEach(async () => {
  /*
   * Isolate from the developer's own Git configuration: a global push.default or
   * branch.autoSetupMerge would decide these tests instead of the value each one sets.
   */
  const scratch = await mkdtemp(path.join(tmpdir(), 'openwaggle-worktree-push-config-'))
  const globalConfig = path.join(scratch, 'gitconfig')
  await writeFile(globalConfig, '')
  vi.stubEnv('GIT_CONFIG_GLOBAL', globalConfig)
  vi.stubEnv('GIT_CONFIG_NOSYSTEM', '1')
  workspace = scratch
})

afterEach(async () => {
  showMessageBox.mockClear()
  vi.unstubAllEnvs()
  if (workspace) await rm(workspace, { force: true, recursive: true })
  workspace = null
})

async function git(cwd: string, args: readonly string[]) {
  const { stdout } = await execFile('git', [...IDENTITY, ...args], { cwd })
  return stdout.trim()
}

async function upstreamOf(cwd: string, branch: string) {
  return git(cwd, [
    'for-each-ref',
    '--format=%(upstream:remotename) %(upstream:remoteref)',
    `refs/heads/${branch}`,
  ])
}

/** A clone of a remote whose default branch is main, with `push.default` as given. */
async function repository(pushDefault: PushDefault) {
  const root = workspace ?? ''
  const remote = path.join(root, 'remote.git')
  const work = path.join(root, 'work')
  await git(root, ['init', '--quiet', '--bare', '-b', 'main', remote])
  await git(root, ['clone', '--quiet', remote, work])
  await writeFile(path.join(work, 'a.txt'), 'base\n')
  await git(work, ['add', '--all'])
  await git(work, ['commit', '-m', 'base'])
  await git(work, ['push', '--quiet', '-u', 'origin', 'main'])
  await git(work, ['remote', 'set-head', 'origin', 'main'])
  if (pushDefault !== 'unset') await git(work, ['config', 'push.default', pushDefault])
  return { remote, work, worktree: path.join(root, 'session-worktree') }
}

async function commitIn(worktree: string) {
  await writeFile(path.join(worktree, 'b.txt'), 'agent work\n')
  await git(worktree, ['add', '--all'])
  await git(worktree, ['commit', '-m', 'agent work'])
}

describe('pushing a managed worktree branch', () => {
  it('creates the Session branch without tracking its base ref', {
    timeout: REAL_GIT_TEST_TIMEOUT_MS,
  }, async () => {
    /*
     * `git worktree add -b <branch> <path> origin/main` tracks origin/main through
     * branch.autoSetupMerge. The branch then fails push.default=simple (names differ) and
     * targets main under push.default=upstream. Its upstream is set by its first push instead.
     */
    const { work, worktree } = await repository('unset')

    const created = await createGitWorktree(work, {
      path: worktree,
      branch: BRANCH,
      baseRef: 'origin/main',
    })

    expect(created.ok).toBe(true)
    expect(await upstreamOf(work, BRANCH)).toBe('')
  })

  it.each(PUSH_DEFAULTS)(
    'reports and pushes to its own remote branch with push.default=%s',
    { timeout: REAL_GIT_TEST_TIMEOUT_MS },
    async (pushDefault) => {
      const { remote, work, worktree } = await repository(pushDefault)
      await createGitWorktree(work, { path: worktree, branch: BRANCH, baseRef: 'origin/main' })
      await commitIn(worktree)

      const status = await getLocalVcsStatus(worktree)
      expect(status).toMatchObject({
        ok: true,
        status: {
          refName: BRANCH,
          isDefaultRef: false,
          pushTargetRef: BRANCH,
          pushTargetIsDefaultRef: false,
        },
      })

      const pushed = await pushCurrentBranch(worktree)
      expect(pushed).toMatchObject({
        ok: true,
        destination: { remote: 'origin', branch: BRANCH },
      })
      expect(await git(remote, ['log', '--format=%s', '-1', `refs/heads/${BRANCH}`])).toBe(
        'agent work',
      )
      expect(await git(remote, ['log', '--format=%s', '-1', 'refs/heads/main'])).toBe('base')
      expect(await upstreamOf(worktree, BRANCH)).toBe(`origin refs/heads/${BRANCH}`)

      // The second push reuses the upstream the first one set, still never main.
      await writeFile(path.join(worktree, 'c.txt'), 'more\n')
      await git(worktree, ['add', '--all'])
      await git(worktree, ['commit', '-m', 'more work'])
      await expect(pushCurrentBranch(worktree)).resolves.toMatchObject({
        ok: true,
        destination: { remote: 'origin', branch: BRANCH },
      })
      expect(await git(remote, ['log', '--format=%s', '-1', 'refs/heads/main'])).toBe('base')
    },
  )
})

async function legacyWorktree(pushDefault: PushDefault) {
  const fixture = await repository(pushDefault)
  // What older builds ran: the new branch tracks its base ref through branch.autoSetupMerge.
  await git(fixture.work, [
    'worktree',
    'add',
    '--quiet',
    '-b',
    BRANCH,
    fixture.worktree,
    'origin/main',
  ])
  expect(await upstreamOf(fixture.work, BRANCH)).toBe('origin refs/heads/main')
  await commitIn(fixture.worktree)
  return fixture
}

describe('a branch created by an older build that tracks origin/main', () => {
  it.each(['unset', 'simple'] as const)(
    'keeps the Summary status and publishes the branch under its own name with push.default=%s',
    { timeout: REAL_GIT_TEST_TIMEOUT_MS },
    async (pushDefault) => {
      /*
       * Git itself refuses this push under simple ("the upstream branch of your current branch
       * does not match the name of your current branch"), and that refusal failed the whole
       * Summary Git row. The safe resolution is Git's own "push to the branch of the same name":
       * it publishes origin/<branch> and moves the upstream there, and never writes main.
       */
      const { remote, worktree } = await legacyWorktree(pushDefault)

      const status = await getLocalVcsStatus(worktree)
      expect(status).toMatchObject({
        ok: true,
        status: { refName: BRANCH, pushTargetRef: BRANCH, pushTargetIsDefaultRef: false },
      })

      const pushed = await pushCurrentBranch(worktree)
      expect(pushed).toMatchObject({ ok: true, destination: { remote: 'origin', branch: BRANCH } })
      expect(pushed.message).toBe(`Pushed and set upstream to origin/${BRANCH}.`)
      expect(await git(remote, ['log', '--format=%s', '-1', `refs/heads/${BRANCH}`])).toBe(
        'agent work',
      )
      expect(await git(remote, ['log', '--format=%s', '-1', 'refs/heads/main'])).toBe('base')
      expect(await upstreamOf(worktree, BRANCH)).toBe(`origin refs/heads/${BRANCH}`)
    },
  )

  it('pushes to its own name with push.default=current and leaves the configured upstream', {
    timeout: REAL_GIT_TEST_TIMEOUT_MS,
  }, async () => {
    const { remote, worktree } = await legacyWorktree('current')

    await expect(getLocalVcsStatus(worktree)).resolves.toMatchObject({
      ok: true,
      status: { pushTargetRef: BRANCH, pushTargetIsDefaultRef: false },
    })
    await expect(pushCurrentBranch(worktree)).resolves.toMatchObject({
      ok: true,
      destination: { remote: 'origin', branch: BRANCH },
    })
    expect(await git(remote, ['log', '--format=%s', '-1', 'refs/heads/main'])).toBe('base')
    expect(await upstreamOf(worktree, BRANCH)).toBe('origin refs/heads/main')
  })

  it('reports main as the push target with push.default=upstream, so the default-branch gate asks', {
    timeout: REAL_GIT_TEST_TIMEOUT_MS,
  }, async () => {
    /*
     * The user configured "push to the upstream", and the upstream is main. OpenWaggle keeps that
     * meaning but names main as the destination, so Push and Commit & push confirm first
     * (`targetsDefaultRef`) instead of writing main by accident.
     */
    const { worktree } = await legacyWorktree('upstream')

    await expect(getLocalVcsStatus(worktree)).resolves.toMatchObject({
      ok: true,
      status: { refName: BRANCH, pushTargetRef: 'main', pushTargetIsDefaultRef: true },
    })
  })
})

describe('a push target Git cannot reduce to one branch', () => {
  it('keeps the local status and reports the push target as unknown', {
    timeout: REAL_GIT_TEST_TIMEOUT_MS,
  }, async () => {
    const { work, worktree } = await repository('unset')
    await createGitWorktree(work, { path: worktree, branch: BRANCH, baseRef: 'origin/main' })
    await git(worktree, ['config', 'push.default', 'matching'])

    const status = await getLocalVcsStatus(worktree)

    // Unknown counts as the default branch, so the confirmation still fails closed.
    expect(status).toMatchObject({
      ok: true,
      status: { refName: BRANCH, pushTargetRef: null, pushTargetIsDefaultRef: true },
    })
    await expect(pushCurrentBranch(worktree)).resolves.toMatchObject({
      ok: false,
      code: 'push-failed',
      message: 'OpenWaggle cannot safely run push.default=matching as a single-branch action.',
    })
  })
})

describe('the Session Summary Push gate', () => {
  const event = fromPartial<IpcMainInvokeEvent>({ sender: {} })

  it.each(['unset', 'simple'] as const)(
    'pins the branch of the same name without asking, then pushes there, with push.default=%s',
    { timeout: REAL_GIT_TEST_TIMEOUT_MS },
    async (pushDefault) => {
      const { remote, worktree } = await legacyWorktree(pushDefault)

      const gate = await Effect.runPromise(
        confirmDefaultBranchAction(event, worktree, { action: 'push' }),
      )

      expect(showMessageBox).not.toHaveBeenCalled()
      expect(gate).toMatchObject({
        confirmed: true,
        blockingFailure: null,
        pinnedPushTarget: {
          sourceBranch: BRANCH,
          remote: 'origin',
          branch: BRANCH,
          replacesUpstream: true,
        },
      })
      const revalidated = await Effect.runPromise(
        revalidateGitTarget(worktree, gate.targetIdentity, 'push'),
      )
      expect(revalidated.matches).toBe(true)

      const pushed = await pushCurrentBranch(
        worktree,
        undefined,
        revalidated.pinnedPushTarget ?? undefined,
      )
      expect(pushed).toMatchObject({ ok: true, destination: { remote: 'origin', branch: BRANCH } })
      expect(await git(remote, ['log', '--format=%s', '-1', 'refs/heads/main'])).toBe('base')
      expect(await upstreamOf(worktree, BRANCH)).toBe(`origin refs/heads/${BRANCH}`)
    },
  )

  it('asks before a push that push.default=upstream sends to main, and cancelling stops it', {
    timeout: REAL_GIT_TEST_TIMEOUT_MS,
  }, async () => {
    const { worktree } = await legacyWorktree('upstream')

    const gate = await Effect.runPromise(
      confirmDefaultBranchAction(event, worktree, { action: 'push' }),
    )

    expect(showMessageBox).toHaveBeenCalledTimes(1)
    expect(gate.confirmed).toBe(false)
  })
})

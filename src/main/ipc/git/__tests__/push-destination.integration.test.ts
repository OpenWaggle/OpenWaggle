import { execFile as execFileCallback } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
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
const REAL_GIT_TEST_TIMEOUT_MS = 30_000

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
 * A clone on `feature`, deliberately fetching from `origin/main`, with a configurable push.default.
 *
 * This is the shape that distinguishes fetch tracking from push intent: current writes `feature`, while
 * upstream writes `main` from the same checked-out branch.
 */
async function repositoryTrackingMain(pushDefault: 'current' | 'upstream' = 'current') {
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
  await git(work, ['config', 'push.default', pushDefault])
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
  it('reports the configured current-branch destination, not the fetch upstream', {
    timeout: REAL_GIT_TEST_TIMEOUT_MS,
  }, async () => {
    /*
     * `feature` fetches from origin/main but push.default=current writes origin/feature. The Summary must
     * describe the latter because that is the mutation it will perform.
     */
    const { work } = await repositoryTrackingMain()

    const result = await getLocalVcsStatus(work)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.status.refName).toBe('feature')
    expect(result.status.pushTargetRef).toBe('feature')
    expect(result.status.isDefaultRef).toBe(false)
    expect(result.status.pushTargetIsDefaultRef).toBe(false)
  })

  it('pins the destination resolved from push.default=current', {
    timeout: REAL_GIT_TEST_TIMEOUT_MS,
  }, async () => {
    /*
     * The destination is resolved using Git's own push ref atoms and then named explicitly, so a config
     * race cannot move it between confirmation and mutation.
     */
    const { remote, work } = await repositoryTrackingMain()

    const result = await pushCurrentBranch(work)

    expect(result.ok).toBe(true)
    expect(result.message).toContain('origin/feature')
    expect(result.destination).toMatchObject({ remote: 'origin', branch: 'feature' })
    expect(await git(remote, ['log', '--format=%s', '-1', 'refs/heads/feature'])).toBe(
      'feature work',
    )
    expect(await git(remote, ['log', '--format=%s', '-1', 'refs/heads/main'])).toBe('base')
  })

  it('reports and writes the upstream branch when push.default=upstream', {
    timeout: REAL_GIT_TEST_TIMEOUT_MS,
  }, async () => {
    const { remote, work } = await repositoryTrackingMain('upstream')

    const status = await getLocalVcsStatus(work)
    expect(status).toMatchObject({
      ok: true,
      status: { pushTargetRef: 'main', pushTargetIsDefaultRef: true },
    })

    const result = await pushCurrentBranch(work)
    expect(result).toMatchObject({
      ok: true,
      destination: { remote: 'origin', branch: 'main' },
    })
    expect(await git(remote, ['log', '--format=%s', '-1', 'refs/heads/main'])).toBe('feature work')
  })

  it("honors branch pushRemote and checks that remote's default ref", {
    timeout: REAL_GIT_TEST_TIMEOUT_MS,
  }, async () => {
    const { work } = await repositoryTrackingMain()
    const fork = path.join(workspace ?? '', 'fork.git')
    await git(workspace ?? '', ['init', '--quiet', '--bare', '-b', 'main', fork])
    await git(work, ['remote', 'add', 'fork', fork])
    await git(work, ['push', '--quiet', 'fork', 'main'])
    await git(work, ['remote', 'set-head', 'fork', 'main'])
    await git(work, ['config', 'branch.feature.pushRemote', 'fork'])

    const status = await getLocalVcsStatus(work)
    expect(status).toMatchObject({
      ok: true,
      status: { pushTargetRef: 'feature', pushTargetIsDefaultRef: false },
    })

    const result = await pushCurrentBranch(work)
    expect(result).toMatchObject({
      ok: true,
      destination: { remote: 'fork', branch: 'feature' },
    })
    expect(await git(fork, ['log', '--format=%s', '-1', 'refs/heads/feature'])).toBe('feature work')
  })

  it('fails closed when pushurl points at a repository with unknown default metadata', {
    timeout: REAL_GIT_TEST_TIMEOUT_MS,
  }, async () => {
    const { work } = await repositoryTrackingMain()
    await git(work, ['branch', '-m', 'develop'])
    const pushRepository = path.join(workspace ?? '', 'push-repository.git')
    await git(workspace ?? '', ['init', '--quiet', '--bare', '-b', 'develop', pushRepository])
    await git(work, ['remote', 'set-url', '--push', 'origin', pushRepository])

    const status = await getLocalVcsStatus(work)

    expect(status).toMatchObject({
      ok: true,
      status: {
        refName: 'develop',
        pushTargetRef: 'develop',
        pushTargetIsDefaultRef: true,
      },
    })
  })

  it('refuses a push configured to update the local repository', {
    timeout: REAL_GIT_TEST_TIMEOUT_MS,
  }, async () => {
    const { work } = await repositoryTrackingMain()
    await git(work, ['config', 'branch.feature.pushRemote', '.'])

    await expect(pushCurrentBranch(work)).resolves.toEqual({
      ok: false,
      code: 'push-failed',
      message: 'OpenWaggle cannot safely run a push configured for the local repository.',
    })
  })

  it('uses the selected non-origin remote for a branch first push', {
    timeout: REAL_GIT_TEST_TIMEOUT_MS,
  }, async () => {
    const { remote, work } = await repositoryWithUpstreamOnly()

    const result = await pushCurrentBranch(work)

    expect(result.ok).toBe(true)
    expect(result.message).toContain('upstream/feature')
    expect(result.destination).toMatchObject({ remote: 'upstream', branch: 'feature' })
    expect(await git(remote, ['log', '--format=%s', '-1', 'refs/heads/feature'])).toBe(
      'feature work',
    )
  })

  it('reports the configured push URL instead of the remote fetch URL', {
    timeout: REAL_GIT_TEST_TIMEOUT_MS,
  }, async () => {
    const { remote: fetchRemote, work } = await repositoryWithUpstreamOnly()
    const pushRemote = path.join(workspace ?? '', 'fork.git')
    await git(workspace ?? '', ['init', '--quiet', '--bare', '-b', 'main', pushRemote])
    await git(work, ['remote', 'set-url', '--push', 'upstream', pushRemote])

    const result = await pushCurrentBranch(work)

    expect(result.ok).toBe(true)
    expect(result.destination).toMatchObject({
      remote: 'upstream',
      remoteUrl: pushRemote,
      multiplePushUrls: false,
    })
    expect(result.destination?.remoteUrl).not.toBe(fetchRemote)
    expect(await git(pushRemote, ['log', '--format=%s', '-1', 'refs/heads/feature'])).toBe(
      'feature work',
    )
  })

  it('marks multiple configured push URLs as ambiguous for change-request targeting', {
    timeout: REAL_GIT_TEST_TIMEOUT_MS,
  }, async () => {
    const { work } = await repositoryWithUpstreamOnly()
    const firstPushRemote = path.join(workspace ?? '', 'fork-one.git')
    const secondPushRemote = path.join(workspace ?? '', 'fork-two.git')
    await git(workspace ?? '', ['init', '--quiet', '--bare', '-b', 'main', firstPushRemote])
    await git(workspace ?? '', ['init', '--quiet', '--bare', '-b', 'main', secondPushRemote])
    await git(work, ['remote', 'set-url', '--push', 'upstream', firstPushRemote])
    await git(work, ['remote', 'set-url', '--add', '--push', 'upstream', secondPushRemote])

    const result = await pushCurrentBranch(work)

    expect(result.ok).toBe(true)
    expect(result.destination).toMatchObject({ remoteUrl: null, multiplePushUrls: true })
  })

  it.skipIf(process.platform === 'win32')(
    'keeps a confirmed push pinned when an insteadOf rewrite appears after revalidation',
    { timeout: REAL_GIT_TEST_TIMEOUT_MS },
    async () => {
      const { remote: approvedRemote, work } = await repositoryTrackingMain()
      const redirectedRemote = path.join(workspace ?? '', 'redirected.git')
      const wrapperDirectory = path.join(workspace ?? '', 'git-wrapper')
      const wrapperPath = path.join(wrapperDirectory, 'git')
      await git(workspace ?? '', ['init', '--quiet', '--bare', '-b', 'main', redirectedRemote])

      const approvedUrl = pathToFileURL(approvedRemote).href
      const redirectedUrl = pathToFileURL(redirectedRemote).href
      await git(work, ['remote', 'set-url', '--push', 'origin', approvedUrl])
      await mkdir(wrapperDirectory, { recursive: true })
      await writeFile(
        wrapperPath,
        `#!/bin/sh
set -eu
for argument in "$@"; do
  if [ "$argument" = "push" ]; then
    "$OPENWAGGLE_REWRITE_TEST_REAL_GIT" -C "$PWD" config \
      "url.$OPENWAGGLE_REWRITE_TEST_REDIRECTED_URL.insteadOf" \
      "$OPENWAGGLE_REWRITE_TEST_APPROVED_URL"
    break
  fi
done
exec "$OPENWAGGLE_REWRITE_TEST_REAL_GIT" "$@"
`,
        { mode: 0o755 },
      )

      const realGit = (await execFile('which', ['git'])).stdout.trim()
      vi.stubEnv(
        'PATH',
        [wrapperDirectory, '/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin'].join(
          path.delimiter,
        ),
      )
      vi.stubEnv('OPENWAGGLE_REWRITE_TEST_REAL_GIT', realGit)
      vi.stubEnv('OPENWAGGLE_REWRITE_TEST_APPROVED_URL', approvedUrl)
      vi.stubEnv('OPENWAGGLE_REWRITE_TEST_REDIRECTED_URL', redirectedUrl)

      try {
        const result = await pushCurrentBranch(work, undefined, {
          sourceBranch: 'feature',
          remote: 'origin',
          branch: 'feature',
          pushUrls: [approvedUrl],
        })

        expect(result).toMatchObject({ ok: true })
        expect(await git(approvedRemote, ['log', '--format=%s', '-1', 'refs/heads/feature'])).toBe(
          'feature work',
        )
        await expect(
          git(redirectedRemote, ['show-ref', '--verify', 'refs/heads/feature']),
        ).rejects.toBeDefined()
      } finally {
        vi.unstubAllEnvs()
      }
    },
  )
})

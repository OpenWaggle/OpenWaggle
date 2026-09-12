import { beforeEach, describe, expect, it, vi } from 'vitest'

const { runGitMock, resolveChangeRequestForRefMock, runWithGitNetworkLockMock } = vi.hoisted(
  () => ({
    runGitMock: vi.fn(async (_path: string, _args: string[]) => ({
      code: 0,
      stdout: '',
      stderr: '',
    })),
    runWithGitNetworkLockMock: vi.fn(),
    resolveChangeRequestForRefMock: vi.fn(
      async (
        _path: string,
        _ref: string,
      ): Promise<
        | { ok: true; changeRequest: Record<string, unknown> }
        | { ok: false; code: string; message: string }
      > => ({ ok: false, code: 'no-change-request', message: 'none' }),
    ),
  }),
)

vi.mock('../../../adapters/source-control', () => ({
  getSourceControlProvider: (id?: string) =>
    id ? { id, resolveChangeRequestForRef: resolveChangeRequestForRefMock } : undefined,
}))

vi.mock('../shared', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../shared')>()),
  runGit: runGitMock,
}))

vi.mock('../../../services/git/mutation-lock', () => ({
  runWithGitNetworkLock: runWithGitNetworkLockMock,
}))

const { getLocalVcsStatus, resolvePrimaryRemoteUrl } = await import('../vcs-status-service')
const { resolvePrimaryRemoteResult } = await import('../primary-remote')

function gitResult(
  code: number,
  stdout = '',
  stderr = '',
  metadata: { readonly executionFailed?: boolean } = {},
) {
  return { code, stdout, stderr, ...metadata }
}

/** Route runGit responses by the git subcommand for readable expectations. */
/** Fail if the local status reached the network: it is cached as cheap and gates the quick action. */
function expectNoNetworkCommands() {
  const calls = runGitMock.mock.calls.map((call) => call[1].join(' '))
  const networkVerbs = ['fetch', 'ls-remote', 'push', 'pull', 'clone', 'remote update']
  expect(calls.filter((call) => networkVerbs.some((verb) => call.startsWith(verb)))).toEqual([])
}

function routeGit(routes: Record<string, ReturnType<typeof gitResult>>) {
  runGitMock.mockImplementation(async (_path: string, args: string[]) => {
    const key = args.join(' ')
    for (const [prefix, result] of Object.entries(routes)) {
      if (key.startsWith(prefix)) return result
    }
    if (key === 'rev-parse --is-inside-work-tree') return gitResult(0, 'true\n')
    if (key.startsWith('for-each-ref --format=%(push:remotename)')) {
      return gitResult(0)
    }
    if (key.startsWith('for-each-ref --format=%(upstream:remotename)')) {
      return gitResult(0)
    }
    if (key.startsWith('config --get-all ')) return gitResult(1)
    return gitResult(1, '', 'unrouted')
  })
}

describe('vcs-status-service', () => {
  beforeEach(() => {
    runGitMock.mockReset()
    runWithGitNetworkLockMock
      .mockReset()
      .mockImplementation(async (_path, operation) => operation())
  })

  it('uses the first configured remote when origin does not exist', async () => {
    routeGit({
      'remote get-url origin': gitResult(2, '', 'No such remote'),
      'remote get-url upstream': gitResult(0, 'git@gitlab.example.com:team/project.git\n'),
      remote: gitResult(0, 'upstream\n'),
    })

    await expect(resolvePrimaryRemoteUrl('/repo')).resolves.toBe(
      'git@gitlab.example.com:team/project.git',
    )
  })

  it('does not replace origin after its URL probe fails to execute', async () => {
    routeGit({
      'remote get-url origin': gitResult(1, '', 'spawn git EAGAIN', { executionFailed: true }),
      remote: gitResult(0, 'fork\norigin\n'),
      'remote get-url fork': gitResult(0, 'https://github.com/example/fork.git\n'),
    })

    await expect(resolvePrimaryRemoteResult('/repo')).resolves.toEqual({
      ok: false,
      message: 'Could not read Git remotes: spawn git EAGAIN',
    })
  })

  it('uses that non-origin remote to resolve local default-branch status', async () => {
    routeGit({
      'symbolic-ref --quiet --short HEAD': gitResult(0, 'feature\n'),
      'remote get-url origin': gitResult(2, '', 'No such remote'),
      'remote get-url upstream': gitResult(0, 'git@gitlab.example.com:team/project.git\n'),
      remote: gitResult(0, 'upstream\n'),
      'symbolic-ref --quiet --short refs/remotes/upstream/HEAD': gitResult(0, 'upstream/develop\n'),
      '-c core.quotePath=false status --porcelain=v1 -z': gitResult(0, ''),
      '-c core.quotePath=false diff --numstat -z': gitResult(0, ''),
      '-c core.quotePath=false diff --cached --numstat -z': gitResult(0, ''),
    })

    const result = await getLocalVcsStatus('/repo')

    expect(result).toMatchObject({ ok: true, status: { defaultRef: 'develop' } })
    expectNoNetworkCommands()
  })

  describe('getLocalVcsStatus', () => {
    it('resolves local status without any network command', async () => {
      // The exhaustive route map and final assertion keep this cached quick-action path offline,
      // including when default-ref resolution would otherwise fall through to `ls-remote`.
      routeGit({
        'symbolic-ref --quiet --short HEAD': gitResult(0, 'main\n'),
        'remote get-url origin': gitResult(0, 'git@github.com:o/r.git\n'),
        'symbolic-ref --quiet --short refs/remotes/origin/HEAD': gitResult(0, 'origin/main\n'),
        '-c core.quotePath=false status --porcelain=v1 -z': gitResult(0, ' M src/a.ts\n'),
        '-c core.quotePath=false diff --numstat -z': gitResult(0, '2\t1\tsrc/a.ts\n'),
        '-c core.quotePath=false diff --cached --numstat -z': gitResult(0, ''),
      })

      const result = await getLocalVcsStatus('/repo')
      expect(result.ok).toBe(true)
      if (!result.ok) throw new Error('expected ok')
      expect(result.status).toMatchObject({
        isRepo: true,
        sourceControlProvider: { id: 'github', host: 'github.com' },
        hasPrimaryRemote: true,
        isDefaultRef: true,
        refName: 'main',
        hasWorkingTreeChanges: true,
      })
      expect(result.status.workingTree.files).toEqual([
        { path: 'src/a.ts', insertions: 2, deletions: 1 },
      ])
      expectNoNetworkCommands()
    })

    it('stays offline even when the local origin/HEAD symref is absent', async () => {
      /*
       * The shape that mattered: a repository built with `git init` + `git remote add` has no
       * `refs/remotes/origin/HEAD`, and the shared default-ref resolver falls through to
       * `ls-remote --symref origin HEAD` in exactly that case. The test above routes the symref, so it
       * could never have caught the fall-through.
       */
      routeGit({
        'symbolic-ref --quiet --short HEAD': gitResult(0, 'main\n'),
        'remote get-url origin': gitResult(0, 'git@github.com:o/r.git\n'),
        // An origin exists, so nothing short-circuits before the advertisement lookup.
        remote: gitResult(0, 'origin\n'),
        // Deliberately unrouted: the local symref does not exist here.
        '-c core.quotePath=false status --porcelain=v1 -z': gitResult(0, ''),
        '-c core.quotePath=false diff --numstat -z': gitResult(0, ''),
        '-c core.quotePath=false diff --cached --numstat -z': gitResult(0, ''),
      })

      const result = await getLocalVcsStatus('/repo')

      expect(result.ok).toBe(true)
      expectNoNetworkCommands()
    })

    it('rejects a failed branch read instead of reporting a detached HEAD', async () => {
      routeGit({
        'symbolic-ref --quiet --short HEAD': gitResult(1, '', '', { executionFailed: true }),
        'remote get-url origin': gitResult(0, 'git@github.com:o/r.git\n'),
        '-c core.quotePath=false status --porcelain=v1 -z': gitResult(0, ''),
        '-c core.quotePath=false diff --numstat -z': gitResult(0, ''),
        '-c core.quotePath=false diff --cached --numstat -z': gitResult(0, ''),
      })

      await expect(getLocalVcsStatus('/repo')).resolves.toEqual({
        ok: false,
        code: 'unknown',
        message: 'Could not read the current Git branch.',
      })
    })

    it('preserves a genuine detached HEAD reported quietly by git', async () => {
      routeGit({
        'symbolic-ref --quiet --short HEAD': gitResult(1),
        'remote get-url origin': gitResult(0, 'git@github.com:o/r.git\n'),
        '-c core.quotePath=false status --porcelain=v1 -z': gitResult(0, ''),
        '-c core.quotePath=false diff --numstat -z': gitResult(0, ''),
        '-c core.quotePath=false diff --cached --numstat -z': gitResult(0, ''),
      })

      await expect(getLocalVcsStatus('/repo')).resolves.toMatchObject({
        ok: true,
        status: { refName: null },
      })
    })

    it('rejects a partial working-tree read instead of reporting no changes', async () => {
      routeGit({
        'symbolic-ref --quiet --short HEAD': gitResult(0, 'main\n'),
        'remote get-url origin': gitResult(0, 'git@github.com:o/r.git\n'),
        '-c core.quotePath=false status --porcelain=v1 -z': gitResult(
          1,
          '',
          'fatal: index file corrupt',
        ),
        '-c core.quotePath=false diff --numstat -z': gitResult(0, ''),
        '-c core.quotePath=false diff --cached --numstat -z': gitResult(0, ''),
      })

      await expect(getLocalVcsStatus('/repo')).resolves.toEqual({
        ok: false,
        code: 'unknown',
        message: 'Could not read the Git working tree: fatal: index file corrupt',
      })
    })

    it('rejects a failed remote list instead of reporting a repository without remotes', async () => {
      routeGit({
        'symbolic-ref --quiet --short HEAD': gitResult(0, 'main\n'),
        'remote get-url origin': gitResult(2, '', "error: No such remote 'origin'"),
        remote: gitResult(1, '', 'spawn git EAGAIN'),
        '-c core.quotePath=false status --porcelain=v1 -z': gitResult(0, ''),
        '-c core.quotePath=false diff --numstat -z': gitResult(0, ''),
        '-c core.quotePath=false diff --cached --numstat -z': gitResult(0, ''),
      })

      await expect(getLocalVcsStatus('/repo')).resolves.toEqual({
        ok: false,
        code: 'unknown',
        message: 'Could not read Git remotes: spawn git EAGAIN',
      })
    })

    it('rejects a failed upstream read instead of changing the apparent push target', async () => {
      routeGit({
        'symbolic-ref --quiet --short HEAD': gitResult(0, 'feature\n'),
        'for-each-ref --format=%(push:remotename) refs/heads/feature': gitResult(
          1,
          '',
          'spawn git EAGAIN',
          { executionFailed: true },
        ),
        'remote get-url origin': gitResult(0, 'git@github.com:o/r.git\n'),
        '-c core.quotePath=false status --porcelain=v1 -z': gitResult(0, ''),
        '-c core.quotePath=false diff --numstat -z': gitResult(0, ''),
        '-c core.quotePath=false diff --cached --numstat -z': gitResult(0, ''),
      })

      await expect(getLocalVcsStatus('/repo')).resolves.toEqual({
        ok: false,
        code: 'unknown',
        message: 'Could not read the Git push destination: spawn git EAGAIN',
      })
    })
  })

  it('treats an unknown default branch as the default branch', async () => {
    /*
     * `refs/remotes/origin/HEAD` records the default branch locally, and `git clone` writes it while `git init`
     * plus `git remote add` does not - verified against real git. In such a repository the default branch
     * resolved to nothing and this read false, so the confirmation that guards a push to the default branch
     * never fired and a one-click Commit & push reached it unasked. Unknown has to mean yes.
     */
    runGitMock.mockImplementation(async (_path: string, args: readonly string[]) => {
      const joined = args.join(' ')
      if (joined === 'rev-parse --is-inside-work-tree') {
        return { code: 0, stdout: 'true\n', stderr: '' }
      }
      if (joined.includes('symbolic-ref') && joined.includes('origin/HEAD')) {
        return { code: 1, stdout: '', stderr: '' }
      }
      if (joined.includes('symbolic-ref')) return { code: 0, stdout: 'main\n', stderr: '' }
      if (joined.includes('remote get-url')) {
        return { code: 0, stdout: 'https://github.com/example/repo.git\n', stderr: '' }
      }
      return { code: 0, stdout: '', stderr: '' }
    })

    const result = await getLocalVcsStatus('/repo')

    expect(result.ok && result.status.isDefaultRef).toBe(true)
  })
})

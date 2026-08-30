import { beforeEach, describe, expect, it, vi } from 'vitest'

const { isGitRepositoryMock, runGitMock, resolveChangeRequestForRefMock } = vi.hoisted(() => ({
  isGitRepositoryMock: vi.fn(async (_path: string) => true),
  runGitMock: vi.fn(async (_path: string, _args: string[]) => ({
    code: 0,
    stdout: '',
    stderr: '',
  })),
  resolveChangeRequestForRefMock: vi.fn(
    async (
      _path: string,
      _ref: string,
    ): Promise<
      | { ok: true; changeRequest: Record<string, unknown> }
      | { ok: false; code: string; message: string }
    > => ({ ok: false, code: 'no-change-request', message: 'none' }),
  ),
}))

vi.mock('../../../adapters/source-control', () => ({
  getSourceControlProvider: (id?: string) =>
    id ? { id, resolveChangeRequestForRef: resolveChangeRequestForRefMock } : undefined,
}))

vi.mock('../shared', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../shared')>()),
  isGitRepository: isGitRepositoryMock,
  runGit: runGitMock,
}))

const { getLocalVcsStatus, getRemoteVcsStatus, resolvePrimaryRemoteUrl } = await import(
  '../vcs-status-service'
)

function gitResult(code: number, stdout = '', stderr = '') {
  return { code, stdout, stderr }
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
    return gitResult(1, '', 'unrouted')
  })
}

describe('vcs-status-service', () => {
  beforeEach(() => {
    isGitRepositoryMock.mockReset()
    isGitRepositoryMock.mockResolvedValue(true)
    runGitMock.mockReset()
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

  describe('getLocalVcsStatus', () => {
    it('fails with not-a-repo outside a repository and never calls git', async () => {
      isGitRepositoryMock.mockResolvedValue(false)
      await expect(getLocalVcsStatus('/repo')).resolves.toEqual({
        ok: false,
        code: 'not-a-repo',
        message: 'Selected folder is not a Git repository.',
      })
      expect(runGitMock).not.toHaveBeenCalled()
    })

    it('resolves local status without any network command', async () => {
      /*
       * The routed map below is exhaustive: an unrouted command throws, so a network call added to
       * this path fails the test rather than passing silently. `ls-remote` is what nearly slipped in -
       * the shared default-ref resolver falls through to it whenever the local `origin/HEAD` symref is
       * missing, which is the normal state of a repository built with `git init` + `git remote add`,
       * and this status is cached with a two-second TTL precisely because it is meant to be cheap.
       */
      routeGit({
        'symbolic-ref --quiet --short HEAD': gitResult(0, 'main\n'),
        'remote get-url origin': gitResult(0, 'git@github.com:o/r.git\n'),
        'symbolic-ref --quiet --short refs/remotes/origin/HEAD': gitResult(0, 'origin/main\n'),
        '-c core.quotePath=false status --porcelain=v1': gitResult(0, ' M src/a.ts\n'),
        '-c core.quotePath=false diff --numstat': gitResult(0, '2\t1\tsrc/a.ts\n'),
        '-c core.quotePath=false diff --cached --numstat': gitResult(0, ''),
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
      /*
       * No command that reaches the network. `fetch` was the only one checked, which missed the one
       * that nearly slipped in: the shared default-ref resolver falls through to
       * `ls-remote --symref origin HEAD` whenever the local `origin/HEAD` symref is absent - the normal
       * state of a repository built with `git init` + `git remote add`. This status is cached with a
       * two-second TTL precisely because it is meant to be cheap, and the quick action and the
       * default-branch confirmation gate both wait on it.
       */
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
        '-c core.quotePath=false status --porcelain=v1': gitResult(0, ''),
        '-c core.quotePath=false diff --numstat': gitResult(0, ''),
        '-c core.quotePath=false diff --cached --numstat': gitResult(0, ''),
      })

      const result = await getLocalVcsStatus('/repo')

      expect(result.ok).toBe(true)
      expectNoNetworkCommands()
    })
  })

  describe('getRemoteVcsStatus', () => {
    it('fails with not-a-repo outside a repository', async () => {
      isGitRepositoryMock.mockResolvedValue(false)
      await expect(getRemoteVcsStatus('/repo')).resolves.toMatchObject({
        ok: false,
        code: 'not-a-repo',
      })
    })

    it('maps a failed fetch to remote-unreachable', async () => {
      routeGit({ fetch: gitResult(128, '', 'fatal: unable to access') })
      await expect(getRemoteVcsStatus('/repo')).resolves.toMatchObject({
        ok: false,
        code: 'remote-unreachable',
      })
    })

    it('reports ahead/behind and a null change request when no provider is detected', async () => {
      routeGit({
        fetch: gitResult(0),
        'rev-parse --abbrev-ref @{upstream}': gitResult(0, 'origin/main\n'),
        'rev-list --left-right --count': gitResult(0, '1\t2\n'),
        'symbolic-ref --quiet --short HEAD': gitResult(0, 'main\n'),
        'symbolic-ref --quiet --short refs/remotes/origin/HEAD': gitResult(0, 'origin/main\n'),
      })
      const result = await getRemoteVcsStatus('/repo')
      expect(result).toMatchObject({
        ok: true,
        status: { hasUpstream: true, aheadCount: 1, behindCount: 2, changeRequest: null },
      })
    })

    it('surfaces the open change request resolved by the provider for the current ref', async () => {
      routeGit({
        fetch: gitResult(0),
        'rev-parse --abbrev-ref @{upstream}': gitResult(0, 'origin/feature\n'),
        'rev-list --left-right --count': gitResult(0, '1\t0\n'),
        'symbolic-ref --quiet --short HEAD': gitResult(0, 'feature\n'),
        'symbolic-ref --quiet --short refs/remotes/origin/HEAD': gitResult(0, 'origin/main\n'),
        'remote get-url origin': gitResult(0, 'https://github.com/o/r.git\n'),
      })
      resolveChangeRequestForRefMock.mockResolvedValue({
        ok: true,
        changeRequest: {
          title: 'Add feature',
          url: 'https://github.com/o/r/pull/7',
          baseRef: 'main',
          headRef: 'feature',
          state: 'open',
        },
      })

      const result = await getRemoteVcsStatus('/repo')
      expect(resolveChangeRequestForRefMock).toHaveBeenCalledWith('/repo', 'feature')
      expect(result).toMatchObject({
        ok: true,
        status: { changeRequest: { url: 'https://github.com/o/r/pull/7', state: 'open' } },
      })
    })

    it('maps a provider failure to a null change request (never fails remote status)', async () => {
      routeGit({
        fetch: gitResult(0),
        'rev-parse --abbrev-ref @{upstream}': gitResult(0, 'origin/feature\n'),
        'rev-list --left-right --count': gitResult(0, '0\t0\n'),
        'symbolic-ref --quiet --short HEAD': gitResult(0, 'feature\n'),
        'symbolic-ref --quiet --short refs/remotes/origin/HEAD': gitResult(0, 'origin/main\n'),
        'remote get-url origin': gitResult(0, 'https://github.com/o/r.git\n'),
      })
      resolveChangeRequestForRefMock.mockResolvedValue({
        ok: false,
        code: 'no-change-request',
        message: 'none',
      })

      const result = await getRemoteVcsStatus('/repo')
      expect(result).toMatchObject({ ok: true, status: { changeRequest: null } })
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

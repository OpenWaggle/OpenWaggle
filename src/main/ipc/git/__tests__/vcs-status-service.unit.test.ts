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

const { getLocalVcsStatus, getRemoteVcsStatus } = await import('../vcs-status-service')

function gitResult(code: number, stdout = '', stderr = '') {
  return { code, stdout, stderr }
}

/** Route runGit responses by the git subcommand for readable expectations. */
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
      routeGit({
        'symbolic-ref --quiet --short HEAD': gitResult(0, 'main\n'),
        'remote get-url origin': gitResult(0, 'git@github.com:o/r.git\n'),
        'symbolic-ref --quiet --short refs/remotes/origin/HEAD': gitResult(0, 'origin/main\n'),
        'status --porcelain=v1': gitResult(0, ' M src/a.ts\n'),
        'diff --numstat': gitResult(0, '2\t1\tsrc/a.ts\n'),
        'diff --cached --numstat': gitResult(0, ''),
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
      // No network commands were issued.
      const calls = runGitMock.mock.calls.map((call) => call[1].join(' '))
      expect(calls.some((c) => c.startsWith('fetch'))).toBe(false)
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
})

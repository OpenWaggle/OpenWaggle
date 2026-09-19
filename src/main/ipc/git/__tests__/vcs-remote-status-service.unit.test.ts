import { beforeEach, describe, expect, it, vi } from 'vitest'

const { runGitMock, resolveChangeRequestForRefMock, runWithGitNetworkLockMock } = vi.hoisted(
  () => ({
    runGitMock: vi.fn(),
    runWithGitNetworkLockMock: vi.fn(),
    resolveChangeRequestForRefMock: vi.fn(),
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

const { getRemoteVcsStatus } = await import('../vcs-status-service')

function gitResult(code: number, stdout = '', stderr = '') {
  return { code, stdout, stderr }
}

function routeGit(routes: Readonly<Record<string, ReturnType<typeof gitResult>>>) {
  runGitMock.mockImplementation(async (_path: string, args: readonly string[]) => {
    const command = args.join(' ')
    for (const [prefix, result] of Object.entries(routes)) {
      if (command.startsWith(prefix)) return result
    }
    if (command === 'rev-parse --is-inside-work-tree') return gitResult(0, 'true\n')
    return gitResult(1, '', 'unrouted')
  })
}

describe('remote VCS status', () => {
  beforeEach(() => {
    runGitMock.mockReset()
    resolveChangeRequestForRefMock.mockReset().mockResolvedValue({
      ok: false,
      code: 'no-change-request',
      message: 'none',
    })
    runWithGitNetworkLockMock
      .mockReset()
      .mockImplementation(async (_path, operation) => operation())
  })

  it('fails with not-a-repo outside a repository', async () => {
    routeGit({ 'rev-parse --is-inside-work-tree': gitResult(128) })
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
    expect(runWithGitNetworkLockMock).toHaveBeenCalledWith('/repo', expect.any(Function))
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

  it('maps a provider failure to a null change request', async () => {
    routeGit({
      fetch: gitResult(0),
      'rev-parse --abbrev-ref @{upstream}': gitResult(0, 'origin/feature\n'),
      'rev-list --left-right --count': gitResult(0, '0\t0\n'),
      'symbolic-ref --quiet --short HEAD': gitResult(0, 'feature\n'),
      'symbolic-ref --quiet --short refs/remotes/origin/HEAD': gitResult(0, 'origin/main\n'),
      'remote get-url origin': gitResult(0, 'https://github.com/o/r.git\n'),
    })

    const result = await getRemoteVcsStatus('/repo')
    expect(result).toMatchObject({ ok: true, status: { changeRequest: null } })
  })
})

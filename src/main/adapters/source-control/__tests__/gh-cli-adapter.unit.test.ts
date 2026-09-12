import type { SourceControlRepositoryIdentity } from '@shared/types/git'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CliResult } from '../cli-runner'
import { getSourceControlProvider } from '../index'

const { runCliMock } = vi.hoisted(() => ({
  runCliMock: vi.fn(),
}))

vi.mock('../cli-runner', () => ({ runCli: runCliMock }))

function cli(partial: Partial<CliResult>): CliResult {
  return { stdout: '', stderr: '', code: 0, missing: false, ...partial }
}

const GITHUB_REPOSITORY = {
  provider: 'github',
  host: 'github.com',
  owner: 'o',
  repository: 'r',
} satisfies SourceControlRepositoryIdentity

function githubProvider(repository: SourceControlRepositoryIdentity = GITHUB_REPOSITORY) {
  return getSourceControlProvider('github', repository)
}

describe('source control provider selection', () => {
  it('selects gh/glab adapters by id', () => {
    expect(githubProvider()?.id).toBe('github')
    expect(
      getSourceControlProvider('gitlab', {
        provider: 'gitlab',
        host: 'gitlab.com',
        owner: 'o',
        repository: 'r',
      })?.id,
    ).toBe('gitlab')
    expect(getSourceControlProvider(null, null)).toBeNull()
    expect(getSourceControlProvider('gitlab', GITHUB_REPOSITORY)).toBeNull()
  })
})

describe('github adapter typed failures (never throws)', () => {
  beforeEach(() => runCliMock.mockReset())

  it('returns cli-missing when gh is not installed', async () => {
    runCliMock.mockResolvedValue(cli({ missing: true, code: 1 }))
    const provider = githubProvider()
    await expect(provider?.authStatus('/repo')).resolves.toEqual({
      ok: false,
      code: 'cli-missing',
      message: 'GitHub CLI (gh) is not installed.',
    })
  })

  it('checks authentication for the repository host instead of another configured host', async () => {
    runCliMock.mockResolvedValue(
      cli({ stderr: 'github.example.com\n  ✓ Logged in to github.example.com account octocat' }),
    )
    const provider = githubProvider({
      ...GITHUB_REPOSITORY,
      host: 'github.example.com',
    })

    await provider?.authStatus('/repo')

    expect(runCliMock).toHaveBeenCalledWith(
      'gh',
      ['auth', 'status', '--active', '--hostname', 'github.example.com'],
      '/repo',
    )
  })

  it('returns not-authenticated when a PR command fails with auth error', async () => {
    runCliMock.mockResolvedValue(cli({ code: 1, stderr: 'authentication required' }))
    const provider = githubProvider()
    await expect(provider?.resolveChangeRequestForRef('/repo', 'feat')).resolves.toMatchObject({
      ok: false,
      code: 'not-authenticated',
    })
  })

  it('parses a resolved PR into a typed change request', async () => {
    runCliMock.mockResolvedValue(
      cli({
        stdout: JSON.stringify({
          title: 'T',
          url: 'https://github.com/o/r/pull/1',
          baseRefName: 'main',
          headRefName: 'feat',
          state: 'OPEN',
          isDraft: false,
        }),
      }),
    )
    const provider = githubProvider()
    await expect(provider?.resolveChangeRequestForRef('/repo', 'feat')).resolves.toEqual({
      ok: true,
      changeRequest: {
        title: 'T',
        url: 'https://github.com/o/r/pull/1',
        baseRef: 'main',
        headRef: 'feat',
        state: 'open',
      },
    })
  })

  it('loads bounded lifecycle details and merges with an exact head guard', async () => {
    const details = {
      number: 7,
      title: 'T',
      url: 'https://github.com/o/r/pull/7',
      baseRefName: 'main',
      headRefName: 'feat',
      headRefOid: 'abc123',
      state: 'OPEN',
      isDraft: false,
      mergeable: 'MERGEABLE',
      mergeStateStatus: 'CLEAN',
      reviewDecision: 'APPROVED',
      statusCheckRollup: [],
      files: [],
    }
    runCliMock
      .mockResolvedValueOnce(cli({ stdout: JSON.stringify(details) }))
      .mockResolvedValueOnce(cli({ stdout: '' }))
      .mockResolvedValueOnce(cli({ stdout: JSON.stringify({ ...details, state: 'MERGED' }) }))
    const provider = githubProvider()

    await expect(provider?.getChangeRequestDetails('/repo', '7')).resolves.toMatchObject({
      ok: true,
      changeRequest: { reference: '7', headCommit: 'abc123' },
    })
    await expect(
      provider?.mergeChangeRequest('/repo', '7', 'squash', 'abc123'),
    ).resolves.toMatchObject({ ok: true, changeRequest: { state: 'merged' } })

    expect(runCliMock.mock.calls[0]?.[1]).toEqual([
      'pr',
      'view',
      '7',
      '--repo',
      'github.com/o/r',
      '--json',
      expect.stringContaining('headRefOid'),
    ])
    expect(runCliMock).toHaveBeenNthCalledWith(
      2,
      'gh',
      ['pr', 'merge', '7', '--repo', 'github.com/o/r', '--match-head-commit', 'abc123', '--squash'],
      '/repo',
    )
  })

  it('maps a not-found PR to a friendly no-change-request failure', async () => {
    runCliMock.mockResolvedValue(cli({ code: 1, stderr: 'no pull requests found for branch feat' }))
    const provider = githubProvider()
    await expect(provider?.resolveChangeRequestForRef('/repo', 'feat')).resolves.toMatchObject({
      ok: false,
      code: 'no-change-request',
    })
  })

  it('skips invalid entries when listing pull requests', async () => {
    runCliMock.mockResolvedValue(
      cli({
        stdout: JSON.stringify([
          {
            title: 'Valid',
            url: 'https://github.com/o/r/pull/1',
            baseRefName: 'main',
            headRefName: 'a',
            state: 'OPEN',
          },
          { title: 'no url' },
          null,
        ]),
      }),
    )
    const provider = githubProvider()
    const result = await provider?.listChangeRequests('/repo')
    expect(result).toMatchObject({ ok: true })
    if (result?.ok) expect(result.changeRequests).toHaveLength(1)
    expect(runCliMock.mock.calls[0]?.[1]).toContain('--limit')
  })

  it('rejects a list containing a pull request from another repository', async () => {
    runCliMock.mockResolvedValue(
      cli({
        stdout: JSON.stringify([
          {
            title: 'Foreign',
            url: 'https://github.com/another/r/pull/1',
            baseRefName: 'main',
            headRefName: 'a',
            state: 'OPEN',
          },
        ]),
      }),
    )

    await expect(githubProvider()?.listChangeRequests('/repo')).resolves.toMatchObject({
      ok: false,
      code: 'invalid-target',
    })
  })

  it('checks a change request out by reference', async () => {
    runCliMock.mockResolvedValue(cli({ stdout: '' }))
    const provider = githubProvider()
    await expect(provider?.checkoutChangeRequest('/repo', '42')).resolves.toEqual({
      ok: true,
      reference: '42',
    })
    expect(runCliMock).toHaveBeenCalledWith(
      'gh',
      ['pr', 'checkout', '42', '--repo', 'github.com/o/r'],
      '/repo',
    )
  })

  it('maps a failed checkout to a typed failure', async () => {
    runCliMock.mockResolvedValue(cli({ code: 1, stderr: 'could not find pull request' }))
    const provider = githubProvider()
    await expect(provider?.checkoutChangeRequest('/repo', '999')).resolves.toMatchObject({
      ok: false,
    })
  })

  it('rejects a successful view response from another repository', async () => {
    runCliMock.mockResolvedValue(
      cli({
        stdout: JSON.stringify({
          title: 'Foreign',
          url: 'https://github.com/o/other/pull/9',
          baseRefName: 'main',
          headRefName: 'feat',
          state: 'OPEN',
          isDraft: false,
        }),
      }),
    )

    await expect(githubProvider()?.resolveChangeRequestForRef('/repo', 'feat')).resolves.toEqual({
      ok: false,
      code: 'invalid-target',
      message: 'GitHub CLI returned a pull request outside the approved repository.',
    })
    expect(runCliMock.mock.calls[0]?.[1]).toEqual(
      expect.arrayContaining(['--repo', 'github.com/o/r']),
    )
  })

  it('collapses a same-repository URL before checkout and rejects a foreign URL', async () => {
    runCliMock.mockResolvedValue(cli({ stdout: '' }))
    const provider = githubProvider()

    await expect(
      provider?.checkoutChangeRequest('/repo', 'https://github.com/o/r/pull/42?diff=split'),
    ).resolves.toEqual({ ok: true, reference: '42' })
    await expect(
      provider?.checkoutChangeRequest('/repo', 'https://github.com/o/other/pull/42'),
    ).resolves.toMatchObject({ ok: false, code: 'invalid-target' })

    expect(runCliMock).toHaveBeenCalledTimes(1)
    expect(runCliMock).toHaveBeenCalledWith(
      'gh',
      ['pr', 'checkout', '42', '--repo', 'github.com/o/r'],
      '/repo',
    )
  })
})

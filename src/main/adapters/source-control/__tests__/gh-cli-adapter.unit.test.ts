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

describe('source control provider selection', () => {
  it('selects gh/glab adapters by id', () => {
    expect(getSourceControlProvider('github')?.id).toBe('github')
    expect(getSourceControlProvider('gitlab')?.id).toBe('gitlab')
    expect(getSourceControlProvider(null)).toBeNull()
  })
})

describe('github adapter typed failures (never throws)', () => {
  beforeEach(() => runCliMock.mockReset())

  it('returns cli-missing when gh is not installed', async () => {
    runCliMock.mockResolvedValue(cli({ missing: true, code: 1 }))
    const provider = getSourceControlProvider('github')
    await expect(provider?.authStatus('/repo')).resolves.toEqual({
      ok: false,
      code: 'cli-missing',
      message: 'GitHub CLI (gh) is not installed.',
    })
  })

  it('returns not-authenticated when a PR command fails with auth error', async () => {
    runCliMock.mockResolvedValue(cli({ code: 1, stderr: 'authentication required' }))
    const provider = getSourceControlProvider('github')
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
    const provider = getSourceControlProvider('github')
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

  it('maps a not-found PR to a friendly no-change-request failure', async () => {
    runCliMock.mockResolvedValue(cli({ code: 1, stderr: 'no pull requests found for branch feat' }))
    const provider = getSourceControlProvider('github')
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
            url: 'https://x/1',
            baseRefName: 'main',
            headRefName: 'a',
            state: 'OPEN',
          },
          { title: 'no url' },
          null,
        ]),
      }),
    )
    const provider = getSourceControlProvider('github')
    const result = await provider?.listChangeRequests('/repo')
    expect(result).toMatchObject({ ok: true })
    if (result?.ok) expect(result.changeRequests).toHaveLength(1)
  })

  it('checks a change request out by reference', async () => {
    runCliMock.mockResolvedValue(cli({ stdout: '' }))
    const provider = getSourceControlProvider('github')
    await expect(provider?.checkoutChangeRequest('/repo', '42')).resolves.toEqual({
      ok: true,
      reference: '42',
    })
    expect(runCliMock).toHaveBeenCalledWith('gh', ['pr', 'checkout', '42'], '/repo')
  })

  it('maps a failed checkout to a typed failure', async () => {
    runCliMock.mockResolvedValue(cli({ code: 1, stderr: 'could not find pull request' }))
    const provider = getSourceControlProvider('github')
    await expect(provider?.checkoutChangeRequest('/repo', '999')).resolves.toMatchObject({
      ok: false,
    })
  })

  it('omits --base when the repository default could not be resolved locally', async () => {
    runCliMock
      .mockResolvedValueOnce(cli({ stdout: 'https://github.com/o/r/pull/1\n' }))
      .mockResolvedValueOnce(
        cli({
          stdout: JSON.stringify({
            title: 'T',
            url: 'https://github.com/o/r/pull/1',
            baseRefName: 'main',
            headRefName: 'feature/current',
            state: 'OPEN',
            isDraft: false,
          }),
        }),
      )

    await getSourceControlProvider('github')?.openChangeRequest('/repo', {
      headRef: 'feature/current',
      title: 'T',
    })

    expect(runCliMock).toHaveBeenNthCalledWith(
      1,
      'gh',
      expect.not.arrayContaining(['--base']),
      '/repo',
    )
  })

  it('adopts a PR that exists after the create command reports failure', async () => {
    runCliMock
      .mockResolvedValueOnce(cli({ code: 1, stderr: 'connection reset' }))
      .mockResolvedValueOnce(
        cli({
          stdout: JSON.stringify({
            title: 'T',
            url: 'https://github.com/o/r/pull/2',
            baseRefName: 'main',
            headRefName: 'feature/current',
            state: 'OPEN',
            isDraft: false,
          }),
        }),
      )

    await expect(
      getSourceControlProvider('github')?.openChangeRequest('/repo', {
        headRef: 'feature/current',
        baseRef: 'main',
        title: 'T',
      }),
    ).resolves.toMatchObject({
      ok: true,
      changeRequest: { url: 'https://github.com/o/r/pull/2' },
    })
  })

  it.each([
    ['CLOSED', 'main', 'feature/current'],
    ['OPEN', 'release', 'feature/current'],
    ['OPEN', 'main', 'feature/other'],
  ])('does not adopt an unrelated or inactive PR (%s)', async (state, baseRefName, headRefName) => {
    runCliMock
      .mockResolvedValueOnce(cli({ code: 1, stderr: 'connection reset' }))
      .mockResolvedValueOnce(
        cli({
          stdout: JSON.stringify({
            title: 'Old request',
            url: 'https://github.com/o/r/pull/old',
            baseRefName,
            headRefName,
            state,
            isDraft: false,
          }),
        }),
      )

    await expect(
      getSourceControlProvider('github')?.openChangeRequest('/repo', {
        headRef: 'feature/current',
        baseRef: 'main',
        title: 'T',
      }),
    ).resolves.toMatchObject({ ok: false, code: 'unknown' })
  })

  it('preserves a successful create URL when the metadata lookup is transiently unavailable', async () => {
    runCliMock
      .mockResolvedValueOnce(cli({ stdout: 'https://github.com/o/r/pull/3\n' }))
      .mockResolvedValueOnce(cli({ code: 1, stderr: 'connection reset' }))

    await expect(
      getSourceControlProvider('github')?.openChangeRequest('/repo', {
        headRef: 'feature/current',
        baseRef: 'main',
        title: 'T',
        draft: true,
      }),
    ).resolves.toEqual({
      ok: true,
      changeRequest: {
        title: 'T',
        url: 'https://github.com/o/r/pull/3',
        baseRef: 'main',
        headRef: 'feature/current',
        state: 'draft',
      },
    })
  })
})

describe('gitlab adapter defaults', () => {
  beforeEach(() => runCliMock.mockReset())

  it('omits --target-branch when the repository default could not be resolved locally', async () => {
    runCliMock.mockResolvedValueOnce(cli({ stdout: '' })).mockResolvedValueOnce(
      cli({
        stdout: JSON.stringify({
          title: 'T',
          web_url: 'https://gitlab.com/o/r/-/merge_requests/1',
          target_branch: 'main',
          source_branch: 'feature/current',
          state: 'opened',
          draft: false,
        }),
      }),
    )

    await getSourceControlProvider('gitlab')?.openChangeRequest('/repo', {
      headRef: 'feature/current',
      title: 'T',
    })

    expect(runCliMock).toHaveBeenNthCalledWith(
      1,
      'glab',
      expect.not.arrayContaining(['--target-branch']),
      '/repo',
    )
    expect(runCliMock.mock.calls[0]?.[1]).toContain('--yes')
  })

  it('adopts an MR that exists after the create command reports failure', async () => {
    runCliMock
      .mockResolvedValueOnce(cli({ code: 1, stderr: 'connection reset' }))
      .mockResolvedValueOnce(
        cli({
          stdout: JSON.stringify({
            title: 'T',
            web_url: 'https://gitlab.com/o/r/-/merge_requests/2',
            target_branch: 'main',
            source_branch: 'feature/current',
            state: 'opened',
            draft: false,
          }),
        }),
      )

    await expect(
      getSourceControlProvider('gitlab')?.openChangeRequest('/repo', {
        headRef: 'feature/current',
        baseRef: 'main',
        title: 'T',
      }),
    ).resolves.toMatchObject({
      ok: true,
      changeRequest: { url: 'https://gitlab.com/o/r/-/merge_requests/2' },
    })
  })

  it.each([
    ['closed', 'main', 'feature/current'],
    ['opened', 'release', 'feature/current'],
    ['opened', 'main', 'feature/other'],
  ])(
    'does not adopt an unrelated or inactive MR (%s)',
    async (state, targetBranch, sourceBranch) => {
      runCliMock
        .mockResolvedValueOnce(cli({ code: 1, stderr: 'connection reset' }))
        .mockResolvedValueOnce(
          cli({
            stdout: JSON.stringify({
              title: 'Old request',
              web_url: 'https://gitlab.com/o/r/-/merge_requests/old',
              target_branch: targetBranch,
              source_branch: sourceBranch,
              state,
              draft: false,
            }),
          }),
        )

      await expect(
        getSourceControlProvider('gitlab')?.openChangeRequest('/repo', {
          headRef: 'feature/current',
          baseRef: 'main',
          title: 'T',
        }),
      ).resolves.toMatchObject({ ok: false, code: 'unknown' })
    },
  )
})

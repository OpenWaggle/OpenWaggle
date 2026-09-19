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

function githubProvider() {
  return getSourceControlProvider('github', GITHUB_REPOSITORY)
}

describe('github pull request creation', () => {
  beforeEach(() => runCliMock.mockReset())

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

    await githubProvider()?.openChangeRequest('/repo', {
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

  it('passes the complete pull-request payload to GitHub CLI', async () => {
    runCliMock
      .mockResolvedValueOnce(cli({ stdout: 'https://github.com/o/r/pull/1\n' }))
      .mockResolvedValueOnce(
        cli({
          stdout: JSON.stringify({
            title: 'Session Summary',
            url: 'https://github.com/o/r/pull/1',
            baseRefName: 'main',
            headRefName: 'feature/current',
            state: 'OPEN',
            isDraft: false,
          }),
        }),
      )

    await githubProvider()?.openChangeRequest('/repo', {
      headRef: 'feature/current',
      baseRef: 'main',
      title: 'Session Summary',
      body: 'Review-ready details',
      draft: false,
    })

    expect(runCliMock).toHaveBeenNthCalledWith(
      1,
      'gh',
      [
        'pr',
        'create',
        '--head',
        'feature/current',
        '--title',
        'Session Summary',
        '--body',
        'Review-ready details',
        '--repo',
        'github.com/o/r',
        '--base',
        'main',
      ],
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
      githubProvider()?.openChangeRequest('/repo', {
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
      githubProvider()?.openChangeRequest('/repo', {
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
      githubProvider()?.openChangeRequest('/repo', {
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

  it('rejects a successful create URL for another repository', async () => {
    runCliMock
      .mockResolvedValueOnce(cli({ stdout: 'https://github.com/o/other/pull/3\n' }))
      .mockResolvedValueOnce(cli({ code: 1, stderr: 'connection reset' }))

    await expect(
      githubProvider()?.openChangeRequest('/repo', {
        headRef: 'feature/current',
        baseRef: 'main',
        title: 'T',
      }),
    ).resolves.toMatchObject({ ok: false, code: 'unknown' })

    expect(runCliMock.mock.calls[0]?.[1]).toEqual(
      expect.arrayContaining(['--repo', 'github.com/o/r']),
    )
  })
})

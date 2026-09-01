import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CliResult } from '../cli-runner'
import { getSourceControlProvider } from '../index'

const { runCliMock } = vi.hoisted(() => ({ runCliMock: vi.fn() }))

vi.mock('../cli-runner', () => ({ runCli: runCliMock }))

function cli(partial: Partial<CliResult>): CliResult {
  return { stdout: '', stderr: '', code: 0, missing: false, ...partial }
}

describe('GitHub fork pull requests', () => {
  beforeEach(() => runCliMock.mockReset())

  it('creates and recovers a fork PR with an owner-qualified head', async () => {
    runCliMock
      .mockResolvedValueOnce(cli({ code: 1, stderr: 'connection reset' }))
      .mockResolvedValueOnce(
        cli({
          stdout: JSON.stringify([
            {
              title: 'Other base',
              url: 'https://github.com/upstream/r/pull/1',
              baseRefName: 'release',
              headRefName: 'feature/current',
              headRepositoryOwner: { login: 'contributor' },
              state: 'OPEN',
              isDraft: false,
            },
            {
              title: 'T',
              url: 'https://github.com/upstream/r/pull/2',
              baseRefName: 'main',
              headRefName: 'feature/current',
              headRepositoryOwner: { login: 'Contributor' },
              state: 'OPEN',
              isDraft: false,
            },
          ]),
        }),
      )

    await expect(
      getSourceControlProvider('github')?.openChangeRequest('/repo', {
        headRef: 'feature/current',
        headOwner: 'contributor',
        baseRef: 'main',
        title: 'T',
      }),
    ).resolves.toMatchObject({
      ok: true,
      changeRequest: { url: 'https://github.com/upstream/r/pull/2' },
    })
    expect(runCliMock).toHaveBeenNthCalledWith(
      1,
      'gh',
      expect.arrayContaining(['--head', 'contributor:feature/current']),
      '/repo',
    )
    expect(runCliMock).toHaveBeenNthCalledWith(
      2,
      'gh',
      expect.arrayContaining(['--head', 'feature/current', '--state', 'open']),
      '/repo',
    )
  })

  it('does not recover a same-named PR from a different owner', async () => {
    runCliMock
      .mockResolvedValueOnce(cli({ code: 1, stderr: 'connection reset' }))
      .mockResolvedValueOnce(
        cli({
          stdout: JSON.stringify([
            {
              title: 'Unrelated',
              url: 'https://github.com/upstream/r/pull/3',
              baseRefName: 'main',
              headRefName: 'feature/current',
              headRepositoryOwner: { login: 'someone-else' },
              state: 'OPEN',
              isDraft: false,
            },
          ]),
        }),
      )

    await expect(
      getSourceControlProvider('github')?.openChangeRequest('/repo', {
        headRef: 'feature/current',
        headOwner: 'contributor',
        baseRef: 'main',
        title: 'T',
      }),
    ).resolves.toMatchObject({ ok: false, code: 'unknown' })
  })
})

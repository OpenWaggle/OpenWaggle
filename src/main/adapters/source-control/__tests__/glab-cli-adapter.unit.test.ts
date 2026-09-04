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

describe('gitlab adapter defaults', () => {
  beforeEach(() => runCliMock.mockReset())

  it('checks authentication for the repository GitLab host', async () => {
    runCliMock.mockResolvedValue(
      cli({ stderr: 'gitlab.example.com\n  ✓ Logged in to gitlab.example.com as octocat' }),
    )
    const provider = getSourceControlProvider('gitlab')

    await provider?.authStatus('/repo', 'gitlab.example.com')

    expect(runCliMock).toHaveBeenCalledWith(
      'glab',
      ['auth', 'status', '--hostname', 'gitlab.example.com'],
      '/repo',
    )
  })

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

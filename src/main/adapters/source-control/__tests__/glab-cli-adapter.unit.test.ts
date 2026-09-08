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

const GITLAB_REPOSITORY = {
  provider: 'gitlab',
  host: 'gitlab.com',
  owner: 'o',
  repository: 'r',
} satisfies SourceControlRepositoryIdentity

function gitlabProvider(repository: SourceControlRepositoryIdentity = GITLAB_REPOSITORY) {
  return getSourceControlProvider('gitlab', repository)
}

describe('gitlab adapter defaults', () => {
  beforeEach(() => runCliMock.mockReset())

  it('checks authentication for the repository GitLab host', async () => {
    runCliMock.mockResolvedValue(
      cli({ stderr: 'gitlab.example.com\n  ✓ Logged in to gitlab.example.com as octocat' }),
    )
    const provider = gitlabProvider({ ...GITLAB_REPOSITORY, host: 'gitlab.example.com' })

    await provider?.authStatus('/repo')

    expect(runCliMock).toHaveBeenCalledWith(
      'glab',
      ['auth', 'status', '--hostname', 'gitlab.example.com'],
      '/repo',
    )
  })

  it('loads lifecycle details and merges with the expected SHA', async () => {
    const details = {
      iid: 4,
      title: 'T',
      web_url: 'https://gitlab.com/o/r/-/merge_requests/4',
      target_branch: 'main',
      source_branch: 'feat',
      sha: 'abc123',
      state: 'opened',
      draft: false,
      merge_status: 'can_be_merged',
      approvals_left: 0,
      diff_stats: [],
    }
    runCliMock
      .mockResolvedValueOnce(cli({ stdout: JSON.stringify(details) }))
      .mockResolvedValueOnce(cli({ stdout: '' }))
      .mockResolvedValueOnce(cli({ stdout: JSON.stringify({ ...details, state: 'merged' }) }))
    const provider = gitlabProvider()

    await expect(provider?.getChangeRequestDetails('/repo', '4')).resolves.toMatchObject({
      ok: true,
      changeRequest: { reference: '4', headCommit: 'abc123' },
    })
    await expect(
      provider?.mergeChangeRequest('/repo', '4', 'rebase', 'abc123'),
    ).resolves.toMatchObject({ ok: true, changeRequest: { state: 'merged' } })

    expect(runCliMock).toHaveBeenNthCalledWith(
      2,
      'glab',
      [
        'mr',
        'merge',
        '4',
        '--repo',
        'https://gitlab.com/o/r',
        '--sha',
        'abc123',
        '--yes',
        '--rebase',
      ],
      '/repo',
    )
  })

  it('pins custom-host repository reads and validates their returned URLs', async () => {
    runCliMock.mockResolvedValue(
      cli({
        stdout: JSON.stringify({
          title: 'T',
          web_url: 'https://gitlab.example.com/groups/team/project/-/merge_requests/4',
          target_branch: 'main',
          source_branch: 'feat',
          state: 'opened',
          draft: false,
        }),
      }),
    )
    const provider = gitlabProvider({
      ...GITLAB_REPOSITORY,
      host: 'gitlab.example.com',
      owner: 'groups/team',
      repository: 'project',
    })

    await expect(provider?.resolveChangeRequestForRef('/repo', 'feat')).resolves.toMatchObject({
      ok: true,
      changeRequest: { url: 'https://gitlab.example.com/groups/team/project/-/merge_requests/4' },
    })
    expect(runCliMock).toHaveBeenCalledWith(
      'glab',
      expect.arrayContaining(['--repo', 'https://gitlab.example.com/groups/team/project']),
      '/repo',
    )
  })

  it('rejects a list containing a merge request from another repository', async () => {
    runCliMock.mockResolvedValue(
      cli({
        stdout: JSON.stringify([
          {
            title: 'Foreign',
            web_url: 'https://gitlab.com/o/other/-/merge_requests/1',
            target_branch: 'main',
            source_branch: 'feat',
            state: 'opened',
            draft: false,
          },
        ]),
      }),
    )

    await expect(gitlabProvider()?.listChangeRequests('/repo')).resolves.toMatchObject({
      ok: false,
      code: 'invalid-target',
    })
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

    await gitlabProvider()?.openChangeRequest('/repo', {
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

  it('passes the complete draft merge-request payload to GitLab CLI', async () => {
    runCliMock
      .mockResolvedValueOnce(cli({ stdout: 'https://gitlab.com/o/r/-/merge_requests/1\n' }))
      .mockResolvedValueOnce(
        cli({
          stdout: JSON.stringify({
            title: 'Session Summary',
            web_url: 'https://gitlab.com/o/r/-/merge_requests/1',
            target_branch: 'main',
            source_branch: 'feature/current',
            state: 'opened',
            draft: true,
          }),
        }),
      )

    await gitlabProvider()?.openChangeRequest('/repo', {
      headRef: 'feature/current',
      baseRef: 'main',
      title: 'Session Summary',
      body: 'Review-ready details',
      draft: true,
    })

    expect(runCliMock).toHaveBeenNthCalledWith(
      1,
      'glab',
      [
        'mr',
        'create',
        '--repo',
        'https://gitlab.com/o/r',
        '--source-branch',
        'feature/current',
        '--title',
        'Session Summary',
        '--description',
        'Review-ready details',
        '--yes',
        '--target-branch',
        'main',
        '--draft',
      ],
      '/repo',
    )
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
      gitlabProvider()?.openChangeRequest('/repo', {
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
        gitlabProvider()?.openChangeRequest('/repo', {
          headRef: 'feature/current',
          baseRef: 'main',
          title: 'T',
        }),
      ).resolves.toMatchObject({ ok: false, code: 'unknown' })
    },
  )

  it('rejects a successful create URL from another repository', async () => {
    runCliMock
      .mockResolvedValueOnce(cli({ stdout: 'https://gitlab.com/o/other/-/merge_requests/9\n' }))
      .mockResolvedValueOnce(cli({ code: 1, stderr: 'connection reset' }))

    await expect(
      gitlabProvider()?.openChangeRequest('/repo', {
        headRef: 'feature/current',
        baseRef: 'main',
        title: 'T',
      }),
    ).resolves.toMatchObject({ ok: false, code: 'unknown' })
    expect(runCliMock.mock.calls[0]?.[1]).toEqual(
      expect.arrayContaining(['--repo', 'https://gitlab.com/o/r']),
    )
  })
})

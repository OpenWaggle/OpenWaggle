import type { SourceControlRepositoryIdentity } from '@shared/types/git'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CliResult } from '../cli-runner'
import { getSourceControlProvider } from '../index'

const { runCliMock } = vi.hoisted(() => ({ runCliMock: vi.fn() }))

vi.mock('../cli-runner', () => ({ runCli: runCliMock }))

function cli(partial: Partial<CliResult>): CliResult {
  return { stdout: '', stderr: '', code: 0, missing: false, ...partial }
}

const GITLAB_UPSTREAM = {
  provider: 'gitlab',
  host: 'gitlab.com',
  owner: 'upstream',
  repository: 'r',
} satisfies SourceControlRepositoryIdentity

describe('GitLab fork merge request creation', () => {
  beforeEach(() => runCliMock.mockReset())

  it('creates and recovers an MR with the exact source project', async () => {
    runCliMock
      .mockResolvedValueOnce(cli({ code: 1, stderr: 'connection reset' }))
      .mockResolvedValueOnce(cli({ stdout: JSON.stringify({ id: 42 }) }))
      .mockResolvedValueOnce(
        cli({
          stdout: JSON.stringify([
            {
              title: 'Unrelated fork',
              web_url: 'https://gitlab.com/upstream/r/-/merge_requests/2',
              target_branch: 'main',
              source_branch: 'feature/current',
              source_project_id: 99,
              state: 'opened',
              draft: false,
            },
            {
              title: 'T',
              web_url: 'https://gitlab.com/upstream/r/-/merge_requests/3',
              target_branch: 'main',
              source_branch: 'feature/current',
              source_project_id: 42,
              state: 'opened',
              draft: false,
            },
          ]),
        }),
      )

    await expect(
      getSourceControlProvider('gitlab', GITLAB_UPSTREAM)?.openChangeRequest('/repo', {
        headRef: 'feature/current',
        headRepository: 'contributors/alex/project',
        baseRef: 'main',
        title: 'T',
      }),
    ).resolves.toMatchObject({
      ok: true,
      changeRequest: { url: 'https://gitlab.com/upstream/r/-/merge_requests/3' },
    })
    expect(runCliMock).toHaveBeenNthCalledWith(
      1,
      'glab',
      expect.arrayContaining([
        '--repo',
        'https://gitlab.com/upstream/r',
        '--head',
        'contributors/alex/project',
      ]),
      '/repo',
    )
    expect(runCliMock).toHaveBeenNthCalledWith(
      2,
      'glab',
      ['api', '--hostname', 'gitlab.com', 'projects/contributors%2Falex%2Fproject'],
      '/repo',
    )
    expect(runCliMock).toHaveBeenNthCalledWith(
      3,
      'glab',
      expect.arrayContaining([
        '--repo',
        'https://gitlab.com/upstream/r',
        '--source-branch',
        'feature/current',
        '--target-branch',
        'main',
      ]),
      '/repo',
    )
  })
})

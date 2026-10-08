import type { SourceControlRepositoryIdentity } from '@shared/types/git'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CliResult } from '../cli-runner'
import { getSourceControlProvider } from '../index'

const { runCliMock, warnMock } = vi.hoisted(() => ({
  runCliMock: vi.fn(),
  warnMock: vi.fn(),
}))

vi.mock('../cli-runner', () => ({ runCli: runCliMock }))
vi.mock('../../../logger', () => ({ createLogger: () => ({ warn: warnMock }) }))

function cli(partial: Partial<CliResult>): CliResult {
  return { stdout: '', stderr: '', code: 0, missing: false, ...partial }
}

const GITLAB_REPOSITORY = {
  provider: 'gitlab',
  host: 'gitlab.example.com',
  owner: 'o',
  repository: 'r',
} satisfies SourceControlRepositoryIdentity

function mergeRequestJson(repository: SourceControlRepositoryIdentity = GITLAB_REPOSITORY) {
  return JSON.stringify({
    iid: 4,
    title: 'T',
    web_url: `https://${repository.host}/${repository.owner}/${repository.repository}/-/merge_requests/4`,
    target_branch: 'main',
    source_branch: 'feat',
    sha: 'abc123',
    state: 'opened',
    draft: false,
    changes_count: '2',
  })
}

function diffEntry(path: string, diff: string) {
  return {
    diff,
    new_path: path,
    old_path: path,
    collapsed: false,
    too_large: false,
    new_file: false,
    renamed_file: false,
    deleted_file: false,
  }
}

function loadDetails(repository: SourceControlRepositoryIdentity = GITLAB_REPOSITORY) {
  return getSourceControlProvider('gitlab', repository)?.getChangeRequestDetails('/repo', '4')
}

describe('GitLab merge request diff stats', () => {
  beforeEach(() => {
    runCliMock.mockReset()
    warnMock.mockReset()
  })

  it('reports per-file and total additions and deletions from the merge request diffs', async () => {
    runCliMock.mockResolvedValueOnce(cli({ stdout: mergeRequestJson() })).mockResolvedValueOnce(
      cli({
        stdout: JSON.stringify([
          diffEntry('src/a.ts', '@@ -1,2 +1,3 @@\n context\n-old\n+new\n+added\n'),
          diffEntry('README.md', '@@ -5 +5 @@\n-gone\n'),
        ]),
      }),
    )

    await expect(loadDetails()).resolves.toMatchObject({
      ok: true,
      changeRequest: {
        changedFiles: 2,
        additions: 2,
        deletions: 2,
        files: [
          { path: 'src/a.ts', additions: 2, deletions: 1 },
          { path: 'README.md', additions: 0, deletions: 1 },
        ],
      },
    })
    expect(runCliMock).toHaveBeenNthCalledWith(
      2,
      'glab',
      [
        'api',
        'projects/o%2Fr/merge_requests/4/diffs?page=1&per_page=100',
        '--hostname',
        'gitlab.example.com',
      ],
      '/repo',
    )
  })

  it('counts only hunk lines, not unified diff file headers', async () => {
    runCliMock.mockResolvedValueOnce(cli({ stdout: mergeRequestJson() })).mockResolvedValueOnce(
      cli({
        stdout: JSON.stringify([
          diffEntry(
            'src/counter.c',
            '--- a/src/counter.c\n+++ b/src/counter.c\n@@ -1,2 +1,2 @@\n---i;\n+++i;\n\\ No newline at end of file\n',
          ),
        ]),
      }),
    )

    await expect(loadDetails()).resolves.toMatchObject({
      ok: true,
      changeRequest: {
        additions: 1,
        deletions: 1,
        files: [{ path: 'src/counter.c', additions: 1, deletions: 1 }],
      },
    })
  })

  it('pages through the bound project diffs, capping the file list but not the totals', async () => {
    const repository = {
      ...GITLAB_REPOSITORY,
      owner: 'groups/team',
      repository: 'project',
    } satisfies SourceControlRepositoryIdentity
    const fullPage = Array.from({ length: 100 }, (_, index) =>
      diffEntry(`src/file-${index}.ts`, '@@ -1 +1 @@\n-a\n+b\n'),
    )
    runCliMock
      .mockResolvedValueOnce(cli({ stdout: mergeRequestJson(repository) }))
      .mockResolvedValueOnce(cli({ stdout: JSON.stringify(fullPage) }))
      .mockResolvedValueOnce(
        cli({ stdout: JSON.stringify([diffEntry('src/last.ts', '@@ -0,0 +1,2 @@\n+x\n+y\n')]) }),
      )

    const result = await loadDetails(repository)

    expect(result).toMatchObject({ ok: true, changeRequest: { additions: 102, deletions: 100 } })
    expect(result?.ok && result.changeRequest.files).toHaveLength(100)
    expect(runCliMock).toHaveBeenCalledTimes(3)
    expect(runCliMock).toHaveBeenNthCalledWith(
      3,
      'glab',
      [
        'api',
        'projects/groups%2Fteam%2Fproject/merge_requests/4/diffs?page=2&per_page=100',
        '--hostname',
        'gitlab.example.com',
      ],
      '/repo',
    )
  })

  it('stops at the page cap and withholds totals it could not complete', async () => {
    const fullPage = JSON.stringify(
      Array.from({ length: 100 }, (_, index) =>
        diffEntry(`src/file-${index}.ts`, '@@ -1 +1 @@\n-a\n+b\n'),
      ),
    )
    runCliMock
      .mockResolvedValueOnce(cli({ stdout: mergeRequestJson() }))
      .mockResolvedValue(cli({ stdout: fullPage }))

    const result = await loadDetails()

    expect(result).toMatchObject({ ok: true, changeRequest: { additions: null, deletions: null } })
    expect(result?.ok && result.changeRequest.files).toHaveLength(100)
    expect(runCliMock).toHaveBeenCalledTimes(11)
  })

  it('withholds totals when GitLab omits an oversized file diff', async () => {
    runCliMock.mockResolvedValueOnce(cli({ stdout: mergeRequestJson() })).mockResolvedValueOnce(
      cli({
        stdout: JSON.stringify([
          diffEntry('src/a.ts', '@@ -1 +1 @@\n-a\n+b\n'),
          { ...diffEntry('dist/bundle.js', ''), too_large: true },
          { ...diffEntry('dist/vendor.js', ''), collapsed: true },
        ]),
      }),
    )

    await expect(loadDetails()).resolves.toMatchObject({
      ok: true,
      changeRequest: {
        additions: null,
        deletions: null,
        files: [
          { path: 'src/a.ts', additions: 1, deletions: 1 },
          { path: 'dist/bundle.js' },
          { path: 'dist/vendor.js' },
        ],
      },
    })
  })

  it('counts changed files from complete diffs when GitLab reports no usable changes count', async () => {
    const mergeRequest = { ...JSON.parse(mergeRequestJson()), changes_count: '1000+' }
    runCliMock
      .mockResolvedValueOnce(cli({ stdout: JSON.stringify(mergeRequest) }))
      .mockResolvedValueOnce(
        cli({ stdout: JSON.stringify([diffEntry('src/a.ts', '@@ -1 +1 @@\n-a\n+b\n')]) }),
      )

    await expect(loadDetails()).resolves.toMatchObject({
      ok: true,
      changeRequest: { changedFiles: 1 },
    })
  })

  it.each([
    ['a failed diff call', cli({ code: 1, stderr: '404 Not Found' })],
    ['a missing glab executable', cli({ code: 1, missing: true })],
    ['a malformed diff response', cli({ stdout: 'not json' })],
    ['a non-array diff response', cli({ stdout: JSON.stringify({ message: 'nope' }) })],
  ])('keeps the merge request details when stats are unavailable (%s)', async (_label, diffs) => {
    runCliMock
      .mockResolvedValueOnce(cli({ stdout: mergeRequestJson() }))
      .mockResolvedValueOnce(diffs)

    await expect(loadDetails()).resolves.toMatchObject({
      ok: true,
      changeRequest: {
        reference: '4',
        changedFiles: 2,
        additions: null,
        deletions: null,
        files: [],
      },
    })
    expect(warnMock).toHaveBeenCalledWith(
      'GitLab merge request diff stats unavailable',
      expect.objectContaining({ host: 'gitlab.example.com', reference: '4' }),
    )
  })
})

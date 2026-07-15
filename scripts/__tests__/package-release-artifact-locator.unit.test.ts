import { describe, expect, it } from 'vitest'

import { selectPackageReleaseArtifactRun } from '../package-release-artifact-locator'

describe('package release artifact locator', () => {
  it('selects the newest unexpired artifact from a successful pull-request CI run', async () => {
    const selection = await selectPackageReleaseArtifactRun(
      'package-release-tree',
      [
        {
          createdAt: '2026-07-15T10:00:00Z',
          expired: false,
          name: 'package-release-tree',
          runId: 10,
          sourceSha: 'older',
        },
        {
          createdAt: '2026-07-15T11:00:00Z',
          expired: false,
          name: 'package-release-tree',
          runId: 11,
          sourceSha: 'head',
        },
      ],
      async (runId) => ({
        conclusion: runId === 11 ? 'success' : 'failure',
        event: 'pull_request',
        headSha: runId === 11 ? 'head' : 'older',
        path: '.github/workflows/ci.yml',
      }),
    )

    expect(selection).toEqual({ runId: 11, sourceSha: 'head' })
  })

  it('accepts exact-SHA workflow dispatch artifacts from the CI workflow', async () => {
    const selection = await selectPackageReleaseArtifactRun(
      'package-release-tree',
      [{
        createdAt: '2026-07-15T11:00:00Z',
        expired: false,
        name: 'package-release-tree',
        runId: 12,
        sourceSha: 'release-head',
      }],
      async () => ({
        conclusion: 'success',
        event: 'workflow_dispatch',
        headSha: 'release-head',
        path: '.github/workflows/ci.yml',
      }),
    )

    expect(selection).toEqual({ runId: 12, sourceSha: 'release-head' })
  })

  it('rejects artifacts from a push, another workflow, or a mismatched head', async () => {
    const candidates = [
      {
        createdAt: '2026-07-15T11:00:00Z',
        expired: false,
        name: 'package-release-tree',
        runId: 11,
        sourceSha: 'head',
      },
    ]

    await expect(
      selectPackageReleaseArtifactRun('package-release-tree', candidates, async () => ({
        conclusion: 'success',
        event: 'push',
        headSha: 'head',
        path: '.github/workflows/ci.yml',
      })),
    ).rejects.toThrow('No exact successful release-candidate CI artifact')
  })
})

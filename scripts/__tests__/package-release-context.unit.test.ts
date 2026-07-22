import { describe, expect, it } from 'vitest'

import {
  readPackageReleaseParent,
  resolvePackageReleaseContext,
} from '../package-release-context'

const RELEASE_SHA = 'a'.repeat(40)
const PARENT_SHA = 'b'.repeat(40)
const WORKFLOW_SHA = 'c'.repeat(40)
const VERSION_COMMIT_SHA = 'd'.repeat(40)

describe('package release context', () => {
  it('finds the pre-release parent before trailing release documentation commits', async () => {
    const calls: string[][] = []
    const beforeSha = await readPackageReleaseParent(RELEASE_SHA, async (args) => {
      calls.push([...args])
      return args[0] === 'rev-list' ? VERSION_COMMIT_SHA : PARENT_SHA
    })

    expect(beforeSha).toBe(PARENT_SHA)
    expect(calls).toEqual([
      [
        'rev-list',
        '--first-parent',
        '--max-count=1',
        RELEASE_SHA,
        '--',
        'packages/*/package.json',
      ],
      ['rev-parse', `${VERSION_COMMIT_SHA}^1`],
    ])
  })

  it('preserves the immutable before and source SHAs from a main push', async () => {
    const result = await resolvePackageReleaseContext(
      {
        eventBefore: PARENT_SHA,
        eventName: 'push',
        eventSha: RELEASE_SHA,
        recoveryReleaseSha: '',
        ref: 'refs/heads/main',
      },
      {
        isAncestorOfMain: async () => false,
        readReleaseParent: async () => '',
        resolveCommit: async () => '',
      },
    )

    expect(result).toEqual({ beforeSha: PARENT_SHA, sourceSha: RELEASE_SHA })
  })

  it('resolves an explicit main-branch recovery release and its first parent', async () => {
    const result = await resolvePackageReleaseContext(
      {
        eventBefore: '',
        eventName: 'workflow_dispatch',
        eventSha: WORKFLOW_SHA,
        recoveryReleaseSha: RELEASE_SHA,
        ref: 'refs/heads/main',
      },
      {
        isAncestorOfMain: async () => true,
        readReleaseParent: async () => PARENT_SHA,
        resolveCommit: async () => RELEASE_SHA,
      },
    )

    expect(result).toEqual({ beforeSha: PARENT_SHA, sourceSha: RELEASE_SHA })
  })

  it.each([
    {
      expected: 'canonical 40-character commit SHA',
      input: { recoveryReleaseSha: 'main' },
    },
    {
      expected: 'must run from main',
      input: { ref: 'refs/heads/fix/release' },
    },
  ])('rejects an invalid recovery request: $expected', async ({ expected, input }) => {
    await expect(
      resolvePackageReleaseContext(
        {
          eventBefore: '',
          eventName: 'workflow_dispatch',
          eventSha: WORKFLOW_SHA,
          recoveryReleaseSha: RELEASE_SHA,
          ref: 'refs/heads/main',
          ...input,
        },
        {
          isAncestorOfMain: async () => true,
          readReleaseParent: async () => PARENT_SHA,
          resolveCommit: async () => RELEASE_SHA,
        },
      ),
    ).rejects.toThrow(expected)
  })

  it('rejects a recovery commit that is not reachable from origin/main', async () => {
    await expect(
      resolvePackageReleaseContext(
        {
          eventBefore: '',
          eventName: 'workflow_dispatch',
          eventSha: WORKFLOW_SHA,
          recoveryReleaseSha: RELEASE_SHA,
          ref: 'refs/heads/main',
        },
        {
          isAncestorOfMain: async () => false,
          readReleaseParent: async () => PARENT_SHA,
          resolveCommit: async () => RELEASE_SHA,
        },
      ),
    ).rejects.toThrow('must be reachable from origin/main')
  })
})

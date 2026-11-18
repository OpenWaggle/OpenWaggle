import { describe, expect, it } from 'vitest'
import { changelogEntry, unreleasedNotes } from '../app-release-notes'
import { runReleaseSync } from './app-release-sync.test-harness'

type SyncResult = Awaited<ReturnType<typeof runReleaseSync>>

// The entry lists main's newer feature, so the release files were written again after the merge.
function expectCurrentEntry(result: SyncResult) {
  expect(changelogEntry(result.changelog, result.version)).toContain(
    'project actions ([#7](https://github.com/OpenWaggle/OpenWaggle/pull/7))',
  )
}

describe('desktop app release branch synchronization', () => {
  it.each(['BLOCKED', 'UNKNOWN'] as const)(
    'updates a stale release branch when GitHub reports %s',
    async (mergeStatus) => {
      const result = await runReleaseSync({ mergeStatus })

      expect(result.succeeded, result.stderr).toBe(true)
      expect(result.events).toEqual(['update', `ci ${result.head}`])
      expect(result.manifest).toBe(result.expectedManifest)
      expect(result.outputs).toBe('should_release=false\n')
      expect(result.tags).toBe('')
      expect(result.mainSha).toBe(result.expectedMainSha)
      expect(result.stdout).toContain('Release PR ready for maintainer review')
      expectCurrentEntry(result)
    },
  )

  it('keeps notes main added under Unreleased out of a prerelease entry, without a conflict', async () => {
    const result = await runReleaseSync({ mainNotes: true })

    expect(result.succeeded, result.stderr).toBe(true)
    expect(result.events).toEqual(['update', `ci ${result.head}`])
    expectCurrentEntry(result)
    expect(unreleasedNotes(result.changelog)).toBe('### Highlights\n\n- Notes written on main.')
  })

  it("recovers on the next run when the merge fails after taking main's release files", async () => {
    const result = await runReleaseSync({ updateFailsOnce: true })

    expect(result.firstRunSucceeded).toBe(false)
    expect(result.succeeded, result.stderr).toBe(true)
    expect(result.manifest).toBe(result.expectedManifest)
    expectCurrentEntry(result)
  })

  it.each([
    ['a version-only branch from before CHANGELOG.md was generated', { versionOnly: true }],
    ['a hand-edited entry', { tamper: 'changelog' }],
  ] as const)('writes the release files again over %s', async (_case, options) => {
    const result = await runReleaseSync(options)

    expect(result.succeeded, result.stderr).toBe(true)
    expect(result.manifest).toBe(result.expectedManifest)
    expect(result.changelog).not.toContain('A hand edit.')
    expectCurrentEntry(result)
  })

  it('adopts a stale orphan release branch before synchronizing it', async () => {
    const result = await runReleaseSync({ orphan: true })

    expect(result.succeeded, result.stderr).toBe(true)
    expect(result.events).toEqual(['create', 'update', `ci ${result.head}`])
    expect(result.manifest).toBe(result.expectedManifest)
  })

  it('updates and validates a new exact head when main advances during CI', async () => {
    const result = await runReleaseSync({ advanceDuring: 'ci' })

    expect(result.succeeded, result.stderr).toBe(true)
    expect(result.events).toHaveLength(4)
    expect(result.events[0]).toBe('update')
    expect(result.events[1]).toMatch(/^ci [0-9a-f]{40}$/u)
    expect(result.events[1]).not.toBe(`ci ${result.head}`)
    expect(result.events.slice(2)).toEqual(['update', `ci ${result.head}`])
    expect(result.manifest).toBe(result.expectedManifest)
  })

  it('ends without a release when the maintainer closes the release PR during CI', async () => {
    const result = await runReleaseSync({ closeDuringCi: true })

    expect(result.succeeded, result.stderr).toBe(true)
    expect(result.events).toEqual(['update', `ci ${result.head}`])
    expect(result.outputs).toBe('should_release=false\n')
    expect(result.tags).toBe('')
    expect(result.stdout).toContain('was closed during validation; nothing to prepare')
    expect(result.stdout).not.toContain('Release PR ready for maintainer review')
  })

  it('retries before CI when main advances during the branch update', async () => {
    const result = await runReleaseSync({ advanceDuring: 'update' })

    expect(result.succeeded, result.stderr).toBe(true)
    expect(result.events).toEqual(['update', 'update', `ci ${result.head}`])
    expect(result.manifest).toBe(result.expectedManifest)
  })

  it('rejects an unexpected change introduced by the branch update', async () => {
    const result = await runReleaseSync({ tamperOnUpdate: true })

    expect(result.succeeded).toBe(false)
    expect(result.events).toEqual(['update'])
    expect(result.stdout).not.toContain('Release PR ready for maintainer review')
  })

  it.each(['manifest', 'file'] as const)(
    'rejects an unexpected %s change before updating or validating the branch',
    async (tamper) => {
      const result = await runReleaseSync({ tamper })

      expect(result.succeeded).toBe(false)
      expect(result.events).toEqual([])
      expect(result.stdout).not.toContain('Release PR ready for maintainer review')
    },
  )
})

import { describe, expect, it } from 'vitest'
import { runReleaseSync } from './app-release-sync.test-harness'

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
    },
  )

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

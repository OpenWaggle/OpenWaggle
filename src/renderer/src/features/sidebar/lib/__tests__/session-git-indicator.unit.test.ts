import type { GitStatusSummary } from '@shared/types/git'
import { describe, expect, it } from 'vitest'
import { buildSessionGitIndicator } from '../session-git-indicator'

function status(overrides: Partial<GitStatusSummary> = {}): GitStatusSummary {
  return {
    branch: 'main',
    additions: 0,
    deletions: 0,
    filesChanged: 0,
    changedFiles: [],
    clean: true,
    ahead: 0,
    behind: 0,
    ...overrides,
  }
}

describe('buildSessionGitIndicator', () => {
  /**
   * Unknown status must not render as clean. A session whose status has never been
   * fetched would otherwise be indistinguishable from one confirmed to have no
   * changes, which is the more dangerous of the two to get wrong.
   */
  it('shows nothing when status is unknown', () => {
    expect(buildSessionGitIndicator(null).label).toBe('')
    expect(buildSessionGitIndicator(undefined).label).toBe('')
    expect(buildSessionGitIndicator(null).isDirty).toBe(false)
  })

  it('shows nothing for a clean, synced tree', () => {
    expect(buildSessionGitIndicator(status()).label).toBe('')
  })

  it('reports changed files', () => {
    const indicator = buildSessionGitIndicator(status({ clean: false, filesChanged: 3 }))

    expect(indicator.isDirty).toBe(true)
    expect(indicator.label).toContain('3')
    expect(indicator.description).toBe('3 changed files')
  })

  it('uses the singular for one changed file', () => {
    expect(buildSessionGitIndicator(status({ clean: false, filesChanged: 1 })).description).toBe(
      '1 changed file',
    )
  })

  it('reports ahead and behind counts', () => {
    const indicator = buildSessionGitIndicator(status({ ahead: 2, behind: 1 }))

    expect(indicator.label).toContain('↑2')
    expect(indicator.label).toContain('↓1')
    expect(indicator.description).toBe('2 ahead, 1 behind')
  })

  it('combines dirtiness with divergence', () => {
    const indicator = buildSessionGitIndicator(
      status({ clean: false, filesChanged: 2, ahead: 1, behind: 3 }),
    )

    expect(indicator.description).toBe('2 changed files, 1 ahead, 3 behind')
  })

  // A tree reporting not-clean with no counted files has nothing actionable to show.
  it('treats not-clean with zero changed files as not dirty', () => {
    expect(buildSessionGitIndicator(status({ clean: false, filesChanged: 0 })).isDirty).toBe(false)
    expect(buildSessionGitIndicator(status({ clean: false, filesChanged: 0 })).label).toBe('')
  })

  it('clamps negative counts rather than rendering them', () => {
    const indicator = buildSessionGitIndicator(status({ ahead: -1, behind: -2 }))

    expect(indicator.ahead).toBe(0)
    expect(indicator.behind).toBe(0)
    expect(indicator.label).toBe('')
  })
})

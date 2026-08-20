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
  })

  it('shows nothing for a clean, synced tree', () => {
    expect(buildSessionGitIndicator(status()).label).toBe('')
  })

  /**
   * The changed-file count was removed on purpose. Sessions sharing a working tree all
   * reported the same number, so it said nothing about the session being looked at, and
   * a large number implied a severity it did not carry.
   */
  it('ignores uncommitted changes entirely', () => {
    const indicator = buildSessionGitIndicator(status({ clean: false, filesChanged: 57 }))

    expect(indicator.label).toBe('')
    expect(indicator.description).toBe('')
  })

  it('still reports divergence on a dirty tree', () => {
    const indicator = buildSessionGitIndicator(
      status({ clean: false, filesChanged: 57, ahead: 1, behind: 3 }),
    )

    expect(indicator.label).toBe('↑1 ↓3')
    expect(indicator.description).toBe('1 commit ahead, 3 commits behind')
  })

  it('reports ahead and behind counts', () => {
    const indicator = buildSessionGitIndicator(status({ ahead: 2, behind: 1 }))

    expect(indicator.label).toContain('↑2')
    expect(indicator.label).toContain('↓1')
    expect(indicator.description).toBe('2 commits ahead, 1 commit behind')
  })

  it('uses the singular for a single commit', () => {
    expect(buildSessionGitIndicator(status({ ahead: 1 })).description).toBe('1 commit ahead')
    expect(buildSessionGitIndicator(status({ behind: 1 })).description).toBe('1 commit behind')
  })

  it('clamps negative counts rather than rendering them', () => {
    const indicator = buildSessionGitIndicator(status({ ahead: -1, behind: -2 }))

    expect(indicator.ahead).toBe(0)
    expect(indicator.behind).toBe(0)
    expect(indicator.label).toBe('')
  })
})

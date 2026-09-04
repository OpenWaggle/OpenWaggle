import type { VcsStatus } from '@shared/types/git'
import { describe, expect, it } from 'vitest'
import { resolveSessionSummaryGitAction } from '../session-summary-git-action'

function status(overrides: Partial<VcsStatus> = {}): VcsStatus {
  return {
    isRepo: true,
    sourceControlProvider: { id: 'github', host: 'github.com' },
    hasPrimaryRemote: true,
    isDefaultRef: false,
    pushTargetRef: 'feature/session-summary',
    pushTargetIsDefaultRef: false,
    refName: 'feature/session-summary',
    hasWorkingTreeChanges: false,
    workingTree: { files: [], insertions: 0, deletions: 0 },
    hasUpstream: true,
    aheadCount: 0,
    behindCount: 0,
    aheadOfDefaultCount: 0,
    changeRequest: null,
    ...overrides,
  }
}

describe('resolveSessionSummaryGitAction', () => {
  it('keeps commit and change-request creation as separate actions', () => {
    expect(
      resolveSessionSummaryGitAction(status({ hasWorkingTreeChanges: true }), false),
    ).toMatchObject({ label: 'Commit or push', action: 'commit_push' })
  })

  it('pushes clean commits without folding in change-request creation', () => {
    expect(resolveSessionSummaryGitAction(status({ aheadCount: 2 }), false)).toMatchObject({
      label: 'Commit or push',
      action: 'push',
    })
  })

  it('commits locally when the repository has no remote', () => {
    expect(
      resolveSessionSummaryGitAction(
        status({ hasWorkingTreeChanges: true, hasPrimaryRemote: false, hasUpstream: false }),
        false,
      ),
    ).toMatchObject({ label: 'Commit or push', action: 'commit' })
  })

  it('explains unavailable, detached, diverged, and idle states', () => {
    expect(resolveSessionSummaryGitAction(null, false)).toMatchObject({
      disabled: true,
      kind: 'show_hint',
    })
    expect(resolveSessionSummaryGitAction(status({ refName: null }), false)).toMatchObject({
      disabled: true,
    })
    expect(
      resolveSessionSummaryGitAction(status({ aheadCount: 1, behindCount: 1 }), false),
    ).toMatchObject({ disabled: true })
    expect(resolveSessionSummaryGitAction(status(), false)).toMatchObject({ disabled: true })
  })

  it('keeps the Codex commit-or-push row disabled when the upstream is ahead', () => {
    expect(resolveSessionSummaryGitAction(status({ behindCount: 2 }), false)).toMatchObject({
      label: 'Commit or push',
      kind: 'show_hint',
      disabled: true,
    })
  })
})

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
    ).toMatchObject({ label: 'Commit or push', disabled: false })
  })

  it('pushes clean commits without folding in change-request creation', () => {
    expect(resolveSessionSummaryGitAction(status({ aheadCount: 2 }), false)).toMatchObject({
      label: 'Commit or push',
      disabled: false,
    })
  })

  it('commits locally when the repository has no remote', () => {
    expect(
      resolveSessionSummaryGitAction(
        status({ hasWorkingTreeChanges: true, hasPrimaryRemote: false, hasUpstream: false }),
        false,
      ),
    ).toMatchObject({ label: 'Commit or push', disabled: false })
  })

  it('explains unavailable and idle states while allowing detached-HEAD recovery', () => {
    expect(resolveSessionSummaryGitAction(null, false)).toMatchObject({
      disabled: true,
      kind: 'show_hint',
    })
    expect(resolveSessionSummaryGitAction(status({ refName: null }), false)).toMatchObject({
      disabled: false,
      kind: 'run_action',
    })
    expect(resolveSessionSummaryGitAction(status(), false)).toMatchObject({ disabled: true })
  })

  it('offers a real retry after bounded Git status recovery is exhausted', () => {
    expect(resolveSessionSummaryGitAction(null, false, 'error')).toEqual({
      label: 'Retry Git status',
      disabled: false,
      kind: 'refresh_status',
      hint: 'Git status could not be loaded.',
    })
  })

  it('opens the command for a first push when a clean branch is ahead of default', () => {
    expect(
      resolveSessionSummaryGitAction(
        status({ hasUpstream: false, aheadCount: 0, aheadOfDefaultCount: 2 }),
        false,
      ),
    ).toMatchObject({ disabled: false, kind: 'run_action' })
  })

  it('uses the detailed local ahead count when remote status is unavailable', () => {
    expect(resolveSessionSummaryGitAction(status(), false, 'loaded', 2)).toMatchObject({
      disabled: false,
      kind: 'run_action',
    })
  })

  it('keeps the Codex commit-or-push row disabled when the upstream is ahead', () => {
    expect(resolveSessionSummaryGitAction(status({ behindCount: 2 }), false)).toMatchObject({
      label: 'Commit or push',
      kind: 'show_hint',
      disabled: true,
    })
  })
})

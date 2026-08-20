import type { SourceControlProviderId, VcsStatus } from '@shared/types/git'
import { describe, expect, it } from 'vitest'
import { resolveQuickAction } from '../git-quick-action'

function status(overrides: Partial<VcsStatus> = {}): VcsStatus {
  return {
    isRepo: true,
    sourceControlProvider: { id: 'github', host: 'github.com' },
    hasPrimaryRemote: true,
    isDefaultRef: false,
    refName: 'feature/x',
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

describe('resolveQuickAction', () => {
  it('is disabled while busy or when status is unavailable', () => {
    expect(resolveQuickAction(status(), true)).toMatchObject({ disabled: true, kind: 'show_hint' })
    expect(resolveQuickAction(null, false)).toMatchObject({ disabled: true, kind: 'show_hint' })
  })

  it('offers commit+push+PR on a dirty feature branch', () => {
    expect(resolveQuickAction(status({ hasWorkingTreeChanges: true }), false)).toMatchObject({
      kind: 'run_action',
      action: 'commit_push_pr',
    })
  })

  it('offers commit & push on a dirty default ref', () => {
    expect(
      resolveQuickAction(status({ hasWorkingTreeChanges: true, isDefaultRef: true }), false),
    ).toMatchObject({ action: 'commit_push' })
  })

  it('offers commit & push on a dirty branch with an open PR', () => {
    expect(
      resolveQuickAction(status({ hasWorkingTreeChanges: true, changeRequest: pr('open') }), false),
    ).toMatchObject({ action: 'commit_push' })
  })

  it('suggests pull when behind upstream', () => {
    expect(resolveQuickAction(status({ behindCount: 2 }), false)).toMatchObject({
      kind: 'run_pull',
    })
  })

  it('blocks with a hint when diverged', () => {
    expect(resolveQuickAction(status({ aheadCount: 1, behindCount: 1 }), false)).toMatchObject({
      kind: 'show_hint',
      disabled: true,
    })
  })

  it('pushes & creates PR when ahead on a feature branch', () => {
    expect(resolveQuickAction(status({ aheadCount: 2 }), false)).toMatchObject({
      action: 'create_pr',
    })
  })

  it('offers publish repository when there is no primary remote or upstream', () => {
    expect(
      resolveQuickAction(status({ hasUpstream: false, hasPrimaryRemote: false }), false),
    ).toMatchObject({ kind: 'open_publish' })
  })

  it('views an open PR when up to date', () => {
    expect(resolveQuickAction(status({ changeRequest: pr('open') }), false)).toMatchObject({
      kind: 'open_pr',
    })
  })

  it('requires a ref before actions', () => {
    expect(resolveQuickAction(status({ refName: null }), false)).toMatchObject({
      disabled: true,
      kind: 'show_hint',
    })
  })

  it('uses MR terminology for gitlab', () => {
    const result = resolveQuickAction(
      status({ hasWorkingTreeChanges: true, sourceControlProvider: provider('gitlab') }),
      false,
    )
    expect(result.label).toContain('MR')
  })

  it('prefers push (not create PR) when clean, ahead, and a PR is open', () => {
    expect(
      resolveQuickAction(status({ aheadCount: 2, changeRequest: pr('open') }), false),
    ).toMatchObject({
      action: 'push',
    })
  })

  it('creates a PR when clean, synced, and ahead of the default ref', () => {
    expect(resolveQuickAction(status({ aheadOfDefaultCount: 3 }), false)).toMatchObject({
      action: 'create_pr',
    })
  })

  it('falls back to plain commit when dirty with no primary remote', () => {
    expect(
      resolveQuickAction(
        status({ hasWorkingTreeChanges: true, hasPrimaryRemote: false, hasUpstream: false }),
        false,
      ),
    ).toMatchObject({ action: 'commit' })
  })

  it('pushes & creates a PR when no upstream but commits are ahead', () => {
    expect(resolveQuickAction(status({ hasUpstream: false, aheadCount: 2 }), false)).toMatchObject({
      action: 'create_pr',
    })
  })

  it('uses push-only (commit_push) on the default ref when no upstream and ahead', () => {
    expect(
      resolveQuickAction(status({ hasUpstream: false, aheadCount: 1, isDefaultRef: true }), false),
    ).toMatchObject({ action: 'commit_push' })
  })
})

function pr(state: 'open' | 'merged' | 'closed' | 'draft') {
  return { title: 'T', url: 'https://x/1', baseRef: 'main', headRef: 'feature/x', state }
}

function provider(id: SourceControlProviderId) {
  return { id, host: id === 'github' ? 'github.com' : 'gitlab.com' }
}

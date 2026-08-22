import { beforeEach, describe, expect, it } from 'vitest'
import { selectThreadDiffScopeSelection, useDiffScopeStore } from '../diff-scope-store'

function reset() {
  useDiffScopeStore.setState({ byThreadKey: {}, branchBaseRefByThreadKey: {} })
}

describe('diff-scope-store', () => {
  beforeEach(reset)

  it('defaults an unseen thread to its working tree', () => {
    /*
     * This used to assert a Branch default plus an "unstaged when dirty" override selected by a
     * `hasWorkingTreeChanges` argument. The only caller passed a hardcoded `true`, so the Branch
     * default was unreachable in production and this test was a false green: it verified a path
     * nothing could take. The argument and that branch are gone.
     */
    const { byThreadKey } = useDiffScopeStore.getState()
    expect(selectThreadDiffScopeSelection(byThreadKey, 't1')).toEqual({ kind: 'unstaged' })
    expect(selectThreadDiffScopeSelection(byThreadKey, null)).toEqual({ kind: 'unstaged' })
  })

  it('remembers the base ref across scope switches (base-ref memory)', () => {
    const store = useDiffScopeStore.getState()
    store.selectBranchBaseRef('t1', 'origin/main')
    store.selectGitScope('t1', 'unstaged')
    expect(useDiffScopeStore.getState().byThreadKey.t1).toEqual({ kind: 'unstaged' })

    // Switching back to branch restores the remembered base ref.
    useDiffScopeStore.getState().selectGitScope('t1', 'branch')
    expect(useDiffScopeStore.getState().byThreadKey.t1).toEqual({
      kind: 'branch',
      baseRef: 'origin/main',
    })
  })

  it('normalizes empty base refs to null', () => {
    useDiffScopeStore.getState().selectBranchBaseRef('t1', '   ')
    expect(useDiffScopeStore.getState().byThreadKey.t1).toEqual({ kind: 'branch', baseRef: null })
  })

  it('increments revealRequestId on repeated turn selection', () => {
    const store = useDiffScopeStore.getState()
    store.selectTurn('t1', 'turn-1', 'a.ts')
    expect(useDiffScopeStore.getState().byThreadKey.t1).toMatchObject({
      kind: 'turn',
      turnId: 'turn-1',
      filePath: 'a.ts',
      revealRequestId: 1,
    })
    useDiffScopeStore.getState().selectTurn('t1', 'turn-1')
    expect(useDiffScopeStore.getState().byThreadKey.t1).toMatchObject({ revealRequestId: 2 })
  })

  it('reconciles a stale turn selection to the latest available turn', () => {
    const store = useDiffScopeStore.getState()
    store.selectTurn('t1', 'gone')
    store.reconcileTurnSelection('t1', ['turn-latest', 'turn-older'])
    expect(useDiffScopeStore.getState().byThreadKey.t1).toMatchObject({
      kind: 'turn',
      turnId: 'turn-latest',
    })
  })

  it('leaves the selection untouched when the selected turn still exists', () => {
    const store = useDiffScopeStore.getState()
    store.selectTurn('t1', 'turn-b')
    store.reconcileTurnSelection('t1', ['turn-a', 'turn-b'])
    expect(useDiffScopeStore.getState().byThreadKey.t1).toMatchObject({ turnId: 'turn-b' })
  })

  it('removes all state for a thread', () => {
    const store = useDiffScopeStore.getState()
    store.selectBranchBaseRef('t1', 'main')
    store.removeThread('t1')
    const state = useDiffScopeStore.getState()
    expect(state.byThreadKey.t1).toBeUndefined()
    expect(state.branchBaseRefByThreadKey.t1).toBeUndefined()
  })

  it('preserves an explicit scope selection over the default', () => {
    useDiffScopeStore.getState().selectGitScope('t1', 'branch')
    const { byThreadKey } = useDiffScopeStore.getState()
    // The stored choice wins; only an unseen thread falls back to the default.
    expect(selectThreadDiffScopeSelection(byThreadKey, 't1')).toEqual({
      kind: 'branch',
      baseRef: null,
    })
  })

  it('clears incompatible selection fields when switching scopes', () => {
    const store = useDiffScopeStore.getState()
    store.selectBranchBaseRef('t1', 'origin/main')
    store.selectGitScope('t1', 'unstaged')
    // The unstaged selection carries no baseRef field.
    expect(useDiffScopeStore.getState().byThreadKey.t1).toEqual({ kind: 'unstaged' })
  })

  it('inherits the draft scope when a new session has none recorded', () => {
    /*
     * Sessions are created on the first send, so the scope tab the reviewer chose was recorded against the
     * working path. Without inheriting it the panel snapped back to the working-tree scope in the very render
     * the session appeared, discarding the choice - and orphaning a review written in another scope, because
     * the key a review lives under carries the scope.
     */
    const byThreadKey = { '/repo': { kind: 'branch', baseRef: 'origin/main' } } as const

    expect(selectThreadDiffScopeSelection(byThreadKey, 'session-1', '/repo')).toEqual({
      kind: 'branch',
      baseRef: 'origin/main',
    })
  })

  it("prefers the session's own scope over the inherited one", () => {
    const byThreadKey = {
      '/repo': { kind: 'branch', baseRef: 'origin/main' },
      'session-1': { kind: 'unstaged' },
    } as const

    expect(selectThreadDiffScopeSelection(byThreadKey, 'session-1', '/repo')).toEqual({
      kind: 'unstaged',
    })
  })
})

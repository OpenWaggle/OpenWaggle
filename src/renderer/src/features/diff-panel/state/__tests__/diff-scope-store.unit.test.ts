import { beforeEach, describe, expect, it } from 'vitest'
import { selectThreadDiffScopeSelection, useDiffScopeStore } from '../diff-scope-store'

function reset() {
  useDiffScopeStore.setState({ byThreadKey: {}, branchBaseRefByThreadKey: {} })
}

describe('diff-scope-store', () => {
  beforeEach(reset)

  it('defaults to branch scope, or unstaged when the working tree is dirty', () => {
    const { byThreadKey } = useDiffScopeStore.getState()
    expect(selectThreadDiffScopeSelection(byThreadKey, 't1')).toEqual({
      kind: 'branch',
      baseRef: null,
    })
    expect(selectThreadDiffScopeSelection(byThreadKey, 't1', true)).toEqual({ kind: 'unstaged' })
    expect(selectThreadDiffScopeSelection(byThreadKey, null)).toEqual({
      kind: 'branch',
      baseRef: null,
    })
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

  it('preserves an explicit scope selection when the working-tree state changes', () => {
    useDiffScopeStore.getState().selectGitScope('t1', 'branch')
    const { byThreadKey } = useDiffScopeStore.getState()
    // Even with a dirty working tree, the explicit branch selection stands.
    expect(selectThreadDiffScopeSelection(byThreadKey, 't1', true)).toEqual({
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
})

import { beforeEach, describe, expect, it } from 'vitest'
import { changedFilesCardKey, useChangedFilesCardStore } from '../changed-files-card-store'
import { selectExpandedTurnKeys, useTurnFoldStore } from '../turn-fold-store'

describe('turn-fold-store', () => {
  beforeEach(() => {
    useTurnFoldStore.setState({ expandedTurnKeysBySessionId: new Map() })
  })

  it('toggles a fold key per session scope without leaking across sessions', () => {
    useTurnFoldStore.getState().toggleTurnFold('s1', 'turn-fold:s1:a1')
    useTurnFoldStore.getState().toggleTurnFold('s1', 'turn-fold:s1:a2')
    useTurnFoldStore.getState().toggleTurnFold('s2', 'turn-fold:s2:b1')
    useTurnFoldStore.getState().toggleTurnFold('s1', 'turn-fold:s1:a1')

    expect(selectExpandedTurnKeys('s1')(useTurnFoldStore.getState())).toEqual(
      new Set(['turn-fold:s1:a2']),
    )
    expect(selectExpandedTurnKeys('s2')(useTurnFoldStore.getState())).toEqual(
      new Set(['turn-fold:s2:b1']),
    )
  })

  it('groups sessionless folds under one scope', () => {
    useTurnFoldStore.getState().toggleTurnFold(null, 'turn-fold:null:a1')
    expect(selectExpandedTurnKeys(null)(useTurnFoldStore.getState())).toEqual(
      new Set(['turn-fold:null:a1']),
    )
  })
})

describe('changed-files-card-store', () => {
  beforeEach(() => {
    useChangedFilesCardStore.setState({ expandedByCardKey: {} })
  })

  it('persists expansion per card key', () => {
    const key = changedFilesCardKey('s1', 'turn-1')
    useChangedFilesCardStore.getState().setExpanded(key, true)
    expect(useChangedFilesCardStore.getState().expandedByCardKey[key]).toBe(true)
    useChangedFilesCardStore.getState().setExpanded(key, false)
    expect(useChangedFilesCardStore.getState().expandedByCardKey[key]).toBe(false)
  })

  it('absent keys leave the auto-expand rule in charge', () => {
    expect(
      useChangedFilesCardStore.getState().expandedByCardKey[changedFilesCardKey('s1', 'x')],
    ).toBeUndefined()
  })
})

import { describe, expect, it } from 'vitest'
import { buildPiModelContextPath, buildPiTranscriptPath } from '../session-entry-paths'

interface Entry {
  readonly id: string
  readonly parentId: string | null
  readonly kind: string
  readonly firstKeptEntryId?: string
}

const ACCESSORS = {
  getId: (entry: Entry) => entry.id,
  getParentId: (entry: Entry) => entry.parentId,
  getKind: (entry: Entry) => entry.kind,
  getContentJson: (entry: Entry) =>
    JSON.stringify(entry.firstKeptEntryId ? { firstKeptEntryId: entry.firstKeptEntryId } : {}),
}

/** A linear Pi log: each entry is the child of the one before it. */
function log(...entries: readonly Omit<Entry, 'parentId'>[]): Entry[] {
  return entries.map((entry, index) => ({ ...entry, parentId: entries[index - 1]?.id ?? null }))
}

const message = (id: string) => ({ id, kind: 'user_message' })
const branchSummary = (id: string) => ({ id, kind: 'branch_summary' })
const compaction = (id: string, firstKeptEntryId: string) => ({
  id,
  kind: 'compaction_summary',
  firstKeptEntryId,
})

function paths(entries: readonly Entry[], activeEntryId: string | null) {
  return {
    transcript: buildPiTranscriptPath(activeEntryId, entries, ACCESSORS).map((entry) => entry.id),
    model: buildPiModelContextPath(activeEntryId, entries, ACCESSORS).map((entry) => entry.id),
  }
}

describe('Session entry paths', () => {
  it('are the same path when nothing was compacted', () => {
    const entries = log(message('a'), branchSummary('s'), message('b'))
    expect(paths(entries, 'b')).toEqual({ transcript: ['a', 's', 'b'], model: ['a', 's', 'b'] })
  })

  it('show the history a compaction summarized while the model starts at the compaction', () => {
    const entries = log(
      message('a'),
      message('b'),
      message('c'),
      compaction('c1', 'b'),
      message('d'),
    )
    expect(paths(entries, 'd')).toEqual({
      transcript: ['a', 'b', 'c', 'c1', 'd'],
      model: ['c1', 'b', 'c', 'd'],
    })
  })

  it('keep every compaction marker in place while the model sees only the latest', () => {
    const entries = log(
      message('a'),
      compaction('c1', 'a'),
      message('b'),
      branchSummary('s'),
      message('c'),
      compaction('c2', 'c'),
      message('d'),
    )
    expect(paths(entries, 'd')).toEqual({
      transcript: ['a', 'c1', 'b', 's', 'c', 'c2', 'd'],
      model: ['c2', 'c', 'd'],
    })
  })

  it('leave out an earlier compaction the latest one kept, which adds nothing to the context', () => {
    const entries = log(message('a'), compaction('c1', 'a'), message('b'), compaction('c2', 'a'))
    expect(paths(entries, 'c2').model).toEqual(['c2', 'a', 'b'])
  })

  it('show everything before a Native checkpoint, which keeps no entry for the model', () => {
    const entries = log(
      message('a'),
      message('b'),
      compaction('c1', 'native-replacement'),
      message('d'),
    )
    expect(paths(entries, 'd')).toEqual({ transcript: ['a', 'b', 'c1', 'd'], model: ['c1', 'd'] })
  })

  it('follow only the selected branch', () => {
    const entries: Entry[] = [
      { id: 'a', parentId: null, kind: 'user_message' },
      { id: 'b', parentId: 'a', kind: 'user_message' },
      { id: 'c1', parentId: 'b', kind: 'compaction_summary', firstKeptEntryId: 'b' },
      { id: 'other', parentId: 'a', kind: 'user_message' },
    ]
    expect(paths(entries, 'other')).toEqual({ transcript: ['a', 'other'], model: ['a', 'other'] })
    expect(paths(entries, 'c1')).toEqual({ transcript: ['a', 'b', 'c1'], model: ['c1', 'b'] })
  })

  it('fall back to every entry without a known active entry', () => {
    const entries = log(message('a'), message('b'))
    expect(paths(entries, null)).toEqual({ transcript: ['a', 'b'], model: ['a', 'b'] })
    expect(paths(entries, 'missing')).toEqual({ transcript: ['a', 'b'], model: ['a', 'b'] })
  })

  it('stop at a parent cycle instead of looping', () => {
    const entries: Entry[] = [
      { id: 'a', parentId: 'b', kind: 'user_message' },
      { id: 'b', parentId: 'a', kind: 'user_message' },
    ]
    expect(paths(entries, 'b').transcript).toEqual(['a', 'b'])
  })
})

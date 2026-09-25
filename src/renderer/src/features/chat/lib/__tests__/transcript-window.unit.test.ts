import { describe, expect, it } from 'vitest'
import {
  extendEarlier,
  extendLater,
  newestRange,
  rangeAround,
  reconcileRange,
  resolveRange,
  trimLiveWindow,
} from '../transcript-window'

const keys = (count: number, prefix = 'row') =>
  Array.from({ length: count }, (_, index) => `${prefix}-${String(index)}`)
const limits = { initialRows: 40, batchRows: 40, maxRows: 160, rowsBeforeAnchor: 20 }

describe('transcript window', () => {
  it('opens at the newest rows and follows the live end', () => {
    const rows = keys(400)
    const range = newestRange(rows)
    expect(range).toMatchObject({ startKey: 'row-360', endKey: null })
    expect(range && resolveRange(range, rows)).toEqual({
      start: 360,
      end: 400,
      hasEarlier: true,
      hasLater: false,
    })
  })

  it('has no window for an empty transcript, and opens once rows arrive', () => {
    expect(newestRange([])).toBeNull()
    // A window mounted before hydration used to compute zero hidden rows and build all 400.
    expect(reconcileRange(null, keys(400))).toMatchObject({ startKey: 'row-360', endKey: null })
  })

  it('fills a live window back up when history is inserted above it', () => {
    const phaseOnly = newestRange(['phase:Thinking'])
    expect(reconcileRange(phaseOnly, [...keys(400), 'phase:Thinking'])).toMatchObject({
      startKey: 'row-361',
      endKey: null,
    })
  })

  it('keeps its start as rows arrive, so new rows are additive', () => {
    const range = newestRange(keys(400))
    expect(reconcileRange(range, keys(401))).toBe(range)
  })

  it('reopens at the newest rows when the list is replaced by an unrelated one', () => {
    // The branch-switch bug: 400 rows to 60 rows used to leave one row visible.
    const range = newestRange(keys(400))
    expect(reconcileRange(range, keys(60, 'alt'))).toMatchObject({
      startKey: 'alt-20',
      endKey: null,
    })
  })

  it('moves an edge to the nearest surviving row when its row folds away', () => {
    const previous = ['u1', 'a1', 'a2', 'a3', 'u2', 'a4']
    const next = ['u1', 'fold-1', 'a3', 'u2', 'a4']
    const live = { startKey: 'a1', endKey: null, members: previous.slice(1) }
    expect(reconcileRange(live, next)).toMatchObject({ startKey: 'a3', endKey: null })
    const bounded = { startKey: 'u1', endKey: 'a2', members: previous.slice(0, 3) }
    expect(reconcileRange(bounded, next)).toMatchObject({ startKey: 'u1', endKey: 'u1' })
  })

  it('loads earlier rows in batches and releases the bottom beyond the bound', () => {
    const rows = keys(400)
    let range = newestRange(rows)
    if (!range) throw new Error('expected a range')
    const first = extendEarlier(range, rows, limits)
    expect(first.added).toBe(40)
    expect(first.range).toMatchObject({ startKey: 'row-320', endKey: null })
    range = first.range
    for (let step = 0; step < 3; step += 1) range = extendEarlier(range, rows, limits).range
    // 40 initial + 4 batches = 200 rows requested, bounded at 160: the bottom 40 are released.
    expect(range).toMatchObject({ startKey: 'row-200', endKey: 'row-359' })
    expect(resolveRange(range, rows)?.hasLater).toBe(true)
  })

  it('stops at the start of the Session', () => {
    const rows = keys(50)
    const range = extendEarlier(
      { startKey: 'row-10', endKey: null, members: rows.slice(10) },
      rows,
      limits,
    )
    expect(range.range.startKey).toBe('row-0')
    expect(extendEarlier(range.range, rows, limits).added).toBe(0)
  })

  it('loads later rows back and rejoins the live end', () => {
    const rows = keys(400)
    const extended = extendLater(
      { startKey: 'row-200', endKey: 'row-359', members: rows.slice(200, 360) },
      rows,
      limits,
    )
    expect(extended.added).toBe(40)
    expect(extended.range).toMatchObject({ startKey: 'row-240', endKey: null })
  })

  it('opens around a restored anchor with context above it', () => {
    const rows = keys(400)
    expect(rangeAround(rows, 'row-100', limits)).toMatchObject({
      startKey: 'row-80',
      endKey: 'row-239',
    })
    expect(rangeAround(rows, 'row-390', limits)).toMatchObject({
      startKey: 'row-370',
      endKey: null,
    })
    expect(rangeAround(rows, 'missing', limits)).toBeNull()
  })

  it('trims a live window that outgrew the bound from the top', () => {
    const rows = keys(400)
    expect(
      trimLiveWindow({ startKey: 'row-200', endKey: null, members: [] }, rows, 160),
    ).toMatchObject({
      startKey: 'row-240',
      endKey: null,
    })
    const bounded = { startKey: 'row-300', endKey: null, members: [] }
    expect(trimLiveWindow(bounded, rows, 160)).toBe(bounded)
  })
})

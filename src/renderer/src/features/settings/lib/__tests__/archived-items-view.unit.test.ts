import { describe, expect, it } from 'vitest'
import {
  archivedDateGroup,
  archivedItemsFilter,
  DEFAULT_ARCHIVED_ITEMS_VIEW,
  effectiveArchivedSort,
  searchHighlightRanges,
} from '../archived-items-view'

/** Wednesday 15 October 2025, 10:00 local time. */
const NOW = new Date(2025, 9, 15, 10).getTime()

function at(month: number, day: number, hour = 12) {
  return new Date(2025, month, day, hour).getTime()
}

describe('archivedDateGroup', () => {
  it('groups by the local calendar, with weeks starting on Monday', () => {
    expect(archivedDateGroup(at(9, 15, 0), NOW)).toBe('Today')
    expect(archivedDateGroup(at(9, 14, 23), NOW)).toBe('Yesterday')
    expect(archivedDateGroup(at(9, 13), NOW)).toBe('Earlier this week')
    expect(archivedDateGroup(at(9, 12), NOW)).toBe('Earlier this month')
    expect(archivedDateGroup(at(9, 1), NOW)).toBe('Earlier this month')
    expect(archivedDateGroup(at(0, 2), NOW)).toBe('Earlier this year')
    expect(archivedDateGroup(new Date(2024, 11, 31).getTime(), NOW)).toBe('Older')
  })
})

describe('searchHighlightRanges', () => {
  it('marks every occurrence of every word, case-insensitively, merging overlaps', () => {
    expect(searchHighlightRanges('Fix OAuth refresh flake', 'oauth FLAKE')).toEqual([
      [4, 9],
      [18, 23],
    ])
    expect(searchHighlightRanges('aaaa', 'aa a')).toEqual([[0, 4]])
    expect(searchHighlightRanges('Anything', '   ')).toEqual([])
  })
})

describe('archivedItemsFilter', () => {
  it('omits whatever means "any", so equal views share one query', () => {
    expect(archivedItemsFilter(DEFAULT_ARCHIVED_ITEMS_VIEW)).toEqual({})
    expect(
      archivedItemsFilter({
        ...DEFAULT_ARCHIVED_ITEMS_VIEW,
        text: '  oauth  ',
        projectPath: null,
        archivedWithin: 'week',
        kind: 'branch',
      }),
    ).toEqual({
      text: 'oauth',
      project: { projectPath: null },
      archivedWithin: 'week',
      kind: 'branch',
    })
  })

  it('ranks by match only while searching, unless a sort was chosen', () => {
    expect(effectiveArchivedSort(DEFAULT_ARCHIVED_ITEMS_VIEW)).toBe('recent')
    expect(effectiveArchivedSort({ ...DEFAULT_ARCHIVED_ITEMS_VIEW, text: 'x' })).toBe('match')
    expect(
      effectiveArchivedSort({ ...DEFAULT_ARCHIVED_ITEMS_VIEW, text: 'x', sort: 'oldest' }),
    ).toBe('oldest')
  })
})

import { describe, expect, it } from 'vitest'
import { storageTotals } from '../WorktreeStorageCard'
import { approximateSpace } from '../worktree-inventory-format'

const MEGABYTE = 1024 * 1024

describe('the space a set of worktrees takes, as copy', () => {
  it('is "about" once each is measured, "at least" while some are not, and absent before', () => {
    const space = new Map<string, number | null | undefined>([
      ['/a', MEGABYTE],
      ['/b', MEGABYTE],
      ['/unreadable', null],
    ])
    expect(approximateSpace(['/a', '/b'], space)).toBe('about 2.0 MB')
    expect(approximateSpace(['/a', '/measuring'], space)).toBe('at least 1.0 MB')
    expect(approximateSpace(['/a', '/unreadable'], space)).toBe('at least 1.0 MB')
    expect(approximateSpace(['/measuring', '/unreadable'], space)).toBeNull()
  })
})

describe('the storage headline', () => {
  it('counts what is measured and says how much is still missing', () => {
    const entries = ['/a', '/b', '/c'].map((path) => ({ path, group: 'safe' as const }))
    const space = new Map<string, number | null | undefined>([
      ['/a', MEGABYTE],
      ['/b', null],
    ])
    expect(storageTotals(entries, space)).toMatchObject({
      total: MEGABYTE,
      measured: 1,
      measuring: 1,
      unreadable: 1,
    })
  })
})

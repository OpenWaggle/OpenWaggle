import { describe, expect, it } from 'vitest'
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

import { describe, expect, it } from 'vitest'
import {
  describeWorkspaceGenerationMismatch,
  isSameDurableDirectoryIdentity,
} from '../workspace-generation'

const recorded = { device: '16777230', inode: '408642463', birthtime: '1792486351612449418' }

describe('isSameDurableDirectoryIdentity', () => {
  it('ignores the device number, which macOS changes across reboots', () => {
    expect(isSameDurableDirectoryIdentity({ ...recorded, device: '16777233' }, recorded)).toBe(true)
  })

  it.each([
    ['inode', { ...recorded, inode: '408642464' }],
    ['birth time', { ...recorded, birthtime: '1792486351612449419' }],
  ])('treats a different %s as a different folder', (_field, current) => {
    expect(isSameDurableDirectoryIdentity(current, recorded)).toBe(false)
  })

  it('treats an unreadable folder as different', () => {
    expect(isSameDurableDirectoryIdentity(null, recorded)).toBe(false)
    expect(isSameDurableDirectoryIdentity(undefined, recorded)).toBe(false)
  })

  it('compares the device number only where the filesystem records no birth time', () => {
    const noBirth = { ...recorded, birthtime: '0' }
    expect(isSameDurableDirectoryIdentity(noBirth, noBirth)).toBe(true)
    expect(isSameDurableDirectoryIdentity({ ...noBirth, device: '16777233' }, noBirth)).toBe(false)
  })
})

describe('describeWorkspaceGenerationMismatch', () => {
  it('shows birth times as dates and leaves the device number to the log', () => {
    const { problem } = describeWorkspaceGenerationMismatch({
      status: 'replaced',
      workspacePath: '/w',
      recorded,
      observed: { device: '16777233', inode: '500', birthtime: '0' },
    })
    expect(problem).toBe(
      '/w is a different folder from the one that was prepared (prepared: inode 408642463, created 2026-10-20T08:52:31.612Z; found: inode 500, unknown creation time)',
    )
  })
})

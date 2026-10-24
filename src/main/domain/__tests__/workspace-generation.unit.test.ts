import type { WorkspacePreparationSnapshot } from '@shared/types/workspace-preparation'
import { fromPartial } from '@total-typescript/shoehorn'
import { describe, expect, it } from 'vitest'
import {
  describeCleanupBlockedByGeneration,
  describeWorkspaceGenerationMismatch,
  durableDirectoryIdentityKey,
  isSameDurableDirectoryIdentity,
  preparationPinsCleanup,
} from '../workspace-generation'

const recorded = { device: '16777230', inode: '408642463', birthtime: '1792486351612449418' }
const noBirth = { ...recorded, birthtime: '0' }

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
    expect(isSameDurableDirectoryIdentity(noBirth, noBirth)).toBe(true)
    expect(isSameDurableDirectoryIdentity({ ...noBirth, device: '16777233' }, noBirth)).toBe(false)
  })
})

describe('durableDirectoryIdentityKey', () => {
  it('stays the same when only the device number changes', () => {
    expect(durableDirectoryIdentityKey({ ...recorded, device: '16777233' })).toBe(
      durableDirectoryIdentityKey(recorded),
    )
  })

  it('changes whenever the comparator would report a different folder', () => {
    expect(durableDirectoryIdentityKey({ ...recorded, inode: '1' })).not.toBe(
      durableDirectoryIdentityKey(recorded),
    )
    expect(durableDirectoryIdentityKey({ ...noBirth, device: '16777233' })).not.toBe(
      durableDirectoryIdentityKey(noBirth),
    )
  })
})

describe('describeWorkspaceGenerationMismatch', () => {
  function replacedDetails(prepared: typeof recorded, found: typeof recorded) {
    return describeWorkspaceGenerationMismatch({
      status: 'replaced',
      workspacePath: '/w',
      recorded: prepared,
      observed: found,
    }).details
  }

  it('shows birth times as dates and leaves the device number to the log', () => {
    expect(replacedDetails(recorded, { device: '16777233', inode: '500', birthtime: '0' })).toBe(
      'Prepared: inode 408642463, created 2026-10-20 08:52:31 UTC; found: inode 500, unknown creation time, device 16777233.',
    )
  })

  it('shows the nanosecond birth times when whole seconds read the same', () => {
    expect(replacedDetails(recorded, { ...recorded, birthtime: '1792486351612449419' })).toBe(
      'Prepared: inode 408642463, created 2026-10-20 08:52:31 UTC, birth time 1792486351612449418 ns; found: inode 408642463, birth time 1792486351612449419 ns.',
    )
  })

  it('shows the device number when it is what told the folders apart', () => {
    expect(replacedDetails(noBirth, { ...noBirth, device: '16777233' })).toBe(
      'Prepared: inode 408642463, unknown creation time, device 16777230; found: inode 408642463, unknown creation time, device 16777233.',
    )
  })

  it.each(['garbled', '99999999999999999999999'])(
    'shows a stored birth time that is not a usable date (%s) as it is',
    (birthtime) => {
      expect(replacedDetails({ ...recorded, birthtime }, recorded)).toContain(
        `Prepared: inode 408642463, birth time ${birthtime};`,
      )
    },
  )

  it.each([
    ['replaced', 'no longer matches'],
    ['unreadable', 'no longer matches'],
    ['awaiting-birth', 'cannot be checked against'],
    ['unrecorded', 'cannot be checked against'],
  ] as const)('says a %s worktree %s its preparation', (status, verdict) => {
    const check =
      status === 'replaced'
        ? { status, workspacePath: '/w', recorded, observed: recorded }
        : status === 'unreadable'
          ? { status, workspacePath: '/w', reason: 'missing' as const, recorded }
          : { status, workspacePath: '/w' }
    expect(describeWorkspaceGenerationMismatch(check).verdict).toBe(verdict)
  })
})

describe('preparationPinsCleanup', () => {
  function snapshot(...phases: ('setup' | 'cleanup')[]) {
    return fromPartial<WorkspacePreparationSnapshot>({
      definitions: phases.map((phase) => ({
        definition: { id: phase, profileId: 'default', phase },
        review: 'enabled',
      })),
    })
  }

  it('is true only when the snapshot has a cleanup-phase definition', () => {
    expect(preparationPinsCleanup(snapshot('setup', 'cleanup'))).toBe(true)
    expect(preparationPinsCleanup(snapshot('setup'))).toBe(false)
    expect(preparationPinsCleanup(snapshot())).toBe(false)
  })
})

describe('describeCleanupBlockedByGeneration', () => {
  it('names the pinned cleanup and Delete anyway', () => {
    expect(describeCleanupBlockedByGeneration({ status: 'unrecorded', workspacePath: '/w' })).toBe(
      'This worktree cannot be checked against the checkout that captured its preparation: the preparation has no record of the folder /w. Its pinned cleanup cannot run here. Choose Delete anyway to remove this checkout without running that cleanup.',
    )
  })
})

import { fromPartial } from '@total-typescript/shoehorn'
import { describe, expect, it } from 'vitest'
import {
  type ResolvedClaim,
  type ResolvedStoredClaim,
  targetsOverlap,
} from '../session-delegation-claim-conflicts'

function current(
  path: string,
  caseSensitive: boolean,
  targetKind: 'workspace-file' | 'workspace-tree',
) {
  return fromPartial<ResolvedClaim>({
    claim: { targetKind },
    targetKey: path,
    caseSensitive,
  })
}

function stored(
  path: string,
  caseSensitive: boolean,
  targetKind: 'workspace-file' | 'workspace-tree',
) {
  return fromPartial<ResolvedStoredClaim>({
    row: { target_kind: targetKind },
    targetKey: path,
    caseSensitive,
  })
}

describe('Delegation claim overlap across workspaces', () => {
  it('finds a file overlap when either bound workspace is case-insensitive', () => {
    expect(
      targetsOverlap(
        current('readme.md', false, 'workspace-file'),
        stored('README.md', true, 'workspace-file'),
      ),
    ).toBe(true)
    expect(
      targetsOverlap(
        current('README.md', true, 'workspace-file'),
        stored('readme.md', false, 'workspace-file'),
      ),
    ).toBe(true)
  })

  it('finds a mixed-filesystem tree/file overlap without collapsing two sensitive paths', () => {
    expect(
      targetsOverlap(
        current('src', false, 'workspace-tree'),
        stored('SRC/Foo.ts', true, 'workspace-file'),
      ),
    ).toBe(true)
    expect(
      targetsOverlap(
        current('README.md', true, 'workspace-file'),
        stored('readme.md', true, 'workspace-file'),
      ),
    ).toBe(false)
  })
})

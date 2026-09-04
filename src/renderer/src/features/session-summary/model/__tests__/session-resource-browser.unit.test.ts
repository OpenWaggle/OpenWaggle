import { SessionBranchId, SessionId } from '@shared/types/brand'
import type { SessionBranch } from '@shared/types/session'
import { describe, expect, it } from 'vitest'
import {
  buildSessionResourceBranchNames,
  resolveResourceBranchName,
} from '../session-resource-browser'

function branch(id: string, name: string): SessionBranch {
  return {
    id: SessionBranchId(id),
    sessionId: SessionId('session-1'),
    sourceNodeId: null,
    headNodeId: null,
    name,
    isMain: false,
    createdAt: 1,
    updatedAt: 2,
  }
}

describe('session resource branch names', () => {
  it('resolves the current friendly name instead of the opaque branch id suffix', () => {
    const branchId = 'session-1:branch:source-node-7'
    const names = buildSessionResourceBranchNames([
      branch(branchId, 'Renamed resource investigation'),
    ])

    expect(resolveResourceBranchName(branchId, names)).toBe('Renamed resource investigation')
  })

  it('never exposes an unknown non-main branch id and safely recognizes main', () => {
    const names = buildSessionResourceBranchNames([])

    expect(resolveResourceBranchName('session-1:branch:source-node-7', names)).toBeNull()
    expect(resolveResourceBranchName('session-1:main', names)).toBe('main')
  })
})

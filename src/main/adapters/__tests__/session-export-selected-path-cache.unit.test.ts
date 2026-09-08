import { describe, expect, it } from 'vitest'
import {
  type ExportSelectedPathSnapshotIdentity,
  SessionExportSelectedPathCache,
} from '../session-export-selected-path-cache'

function identity(selectedHeadNodeId: string): ExportSelectedPathSnapshotIdentity {
  return {
    sessionId: 'session-1',
    selectedBranchId: 'branch-1',
    selectedHeadNodeId,
    nodeMutationRevision: 4,
  }
}

describe('Session export selected-path cache', () => {
  it('evicts least-recently-used snapshot identities at its hard bound', () => {
    const cache = new SessionExportSelectedPathCache({ pathLimit: 2 })
    const first = identity('node-first')
    const second = identity('node-second')
    const third = identity('node-third')

    cache.remember(first)
    cache.remember(second)
    expect(cache.has(first)).toBe(true)
    cache.remember(third)

    expect(cache.has(first)).toBe(true)
    expect(cache.has(second)).toBe(false)
    expect(cache.has(third)).toBe(true)
    expect(cache.diagnostics()).toEqual({ paths: 2 })
  })

  it('retains constant-size identities regardless of selected-path length', () => {
    const cache = new SessionExportSelectedPathCache({ pathLimit: 2 })
    const longPath = identity('node-at-depth-10000000')

    cache.remember(longPath)

    expect(cache.has(longPath)).toBe(true)
    expect(cache.diagnostics()).toEqual({ paths: 1 })
  })
})

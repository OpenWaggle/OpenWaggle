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
  it('evicts least-recently-used paths within both hard bounds', () => {
    const cache = new SessionExportSelectedPathCache({ pathLimit: 2, nodeLimit: 4 })
    const first = identity('node-first')
    const second = identity('node-second')
    const third = identity('node-third')

    expect(cache.remember(first, [1, 2])).toBe(true)
    expect(cache.remember(second, [3])).toBe(true)
    expect(cache.has(first)).toBe(true)
    expect(cache.remember(third, [4, 5])).toBe(true)

    expect(cache.has(first)).toBe(true)
    expect(cache.has(second)).toBe(false)
    expect(cache.has(third)).toBe(true)
    expect(cache.diagnostics()).toEqual({ paths: 2, nodes: 4 })
  })

  it('rejects one oversized path instead of exceeding the node cap', () => {
    const cache = new SessionExportSelectedPathCache({ pathLimit: 2, nodeLimit: 4 })
    const oversized = identity('node-oversized')

    expect(cache.remember(oversized, [1, 2, 3, 4, 5])).toBe(false)
    expect(cache.has(oversized)).toBe(false)
    expect(cache.wasRejected(oversized)).toBe(true)
    expect(cache.diagnostics()).toEqual({ paths: 0, nodes: 0 })
  })

  it('bounds rejected identities with least-recently-used eviction', () => {
    const cache = new SessionExportSelectedPathCache({ pathLimit: 2, nodeLimit: 1 })
    const first = identity('node-rejected-first')
    const second = identity('node-rejected-second')
    const third = identity('node-rejected-third')

    expect(cache.remember(first, [1, 2])).toBe(false)
    expect(cache.remember(second, [1, 2])).toBe(false)
    expect(cache.wasRejected(first)).toBe(true)
    expect(cache.remember(third, [1, 2])).toBe(false)

    expect(cache.wasRejected(first)).toBe(true)
    expect(cache.wasRejected(second)).toBe(false)
    expect(cache.wasRejected(third)).toBe(true)
    expect(cache.diagnostics()).toEqual({ paths: 0, nodes: 0 })
  })

  it('paginates sparse selected orders without retaining descendants past the snapshot', () => {
    const cache = new SessionExportSelectedPathCache({ pathLimit: 1, nodeLimit: 10 })
    const selected = identity('node-selected')
    cache.remember(selected, [0, 3, 7, 12])

    expect(
      cache.readPage(selected, { afterCreatedOrder: 0, throughCreatedOrder: 10, limit: 3 }),
    ).toEqual([3, 7])
  })
})

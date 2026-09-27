import type * as SqlClient from '@effect/sql/SqlClient'
import { SessionId } from '@shared/types/brand'
import { fromAny } from '@total-typescript/shoehorn'
import * as Effect from 'effect/Effect'
import { describe, expect, it, vi } from 'vitest'
import type { ProjectedSessionNodeInput } from '../../../ports/session-repository'
import { nodesToPark, reconcileSnapshotNodes } from '../snapshot-node-reconciliation'
import type { SessionNodeRow } from '../types'

// Force the search predicate off so the ONLY thing that can restore a parked row's order is the
// belt in reconcileSnapshotNodes, not searchProjectionChanged happening to compare created_order.
vi.mock('../snapshot-transcript-term-changes', () => ({
  nodeProjectionChanged: () => true,
  searchProjectionChanged: () => false,
}))

/**
 * `nodesToPark` is the heart of the fix: it decides which rows must vacate their `created_order`
 * slot before any row is rewritten. Covered here over the permutations SQLite's per-row unique
 * check would otherwise reject, without the cost of a full persistence round-trip.
 */

function existing(id: string, createdOrder: number): SessionNodeRow {
  return {
    id,
    session_id: 'session-x',
    parent_id: null,
    pi_entry_type: 'message',
    kind: 'assistant_message',
    role: 'assistant',
    timestamp_ms: createdOrder,
    content_json: '{"parts":[]}',
    metadata_json: '{}',
    branch_hint_id: null,
    path_depth: 0,
    created_order: createdOrder,
  }
}

function next(id: string, createdOrder: number): ProjectedSessionNodeInput {
  return {
    id,
    parentId: null,
    piEntryType: 'message',
    kind: 'assistant_message',
    role: 'assistant',
    timestampMs: createdOrder,
    contentJson: '{"parts":[]}',
    metadataJson: '{}',
    pathDepth: 0,
    createdOrder,
  }
}

describe('nodesToPark', () => {
  it('parks nothing when no order changes (a no-op re-persist)', () => {
    const nodes = [next('a', 0), next('b', 1), next('c', 2)]
    const existingNodes = [existing('a', 0), existing('b', 1), existing('c', 2)]
    expect(nodesToPark({ existingNodes, nodes })).toEqual([])
  })

  it('parks nothing for an append that adds new nodes at fresh orders', () => {
    const existingNodes = [existing('a', 0), existing('b', 1)]
    const nodes = [next('a', 0), next('b', 1), next('c', 2), next('d', 3)]
    expect(nodesToPark({ existingNodes, nodes })).toEqual([])
  })

  it('parks the run that shifts up when a node is inserted below it', () => {
    // Agent-loop nodes b,c shift from 1,2 to 3,4 as two Pi entries land ahead of them.
    const existingNodes = [existing('a', 0), existing('b', 1), existing('c', 2)]
    const nodes = [next('a', 0), next('p', 1), next('q', 2), next('b', 3), next('c', 4)]
    expect(new Set(nodesToPark({ existingNodes, nodes }))).toEqual(new Set(['b', 'c']))
  })

  it('parks the retained node that shifts down and the removed node whose slot it takes', () => {
    // `b` is removed and `c` shifts 2->1 into b's freed slot; both must vacate before c is written.
    const existingNodes = [existing('a', 0), existing('b', 1), existing('c', 2)]
    const nodes = [next('a', 0), next('c', 1)]
    expect(new Set(nodesToPark({ existingNodes, nodes }))).toEqual(new Set(['b', 'c']))
  })

  it('parks both sides of a rotation', () => {
    const existingNodes = [existing('a', 0), existing('b', 1), existing('c', 2)]
    // a->1, b->2, c->0 (a 3-cycle): every node moves.
    const nodes = [next('c', 0), next('a', 1), next('b', 2)]
    expect(new Set(nodesToPark({ existingNodes, nodes }))).toEqual(new Set(['a', 'b', 'c']))
  })
})

describe('reconcileSnapshotNodes', () => {
  it('writes a parked row through the full update even when only its order changed', async () => {
    // With searchProjectionChanged mocked to false (above), a reverted belt would take the cheap
    // update and leave created_order unwritten; this fails then and passes with the belt intact.
    const statements: string[] = []
    const record = (strings: TemplateStringsArray) => {
      statements.push(strings.join('?').replace(/\s+/g, ' ').trim())
      return Effect.void
    }
    const sql = fromAny<SqlClient.SqlClient, typeof record>(record)

    await Effect.runPromise(
      reconcileSnapshotNodes({
        sql,
        sessionId: SessionId('session-x'),
        branchHintByNodeId: new Map(),
        existingNodes: [existing('a', 0), existing('b', 1)],
        // `a` and `b` only move: content, role, kind and parent are unchanged; a new node leads.
        nodes: [next('p', 0), next('a', 1), next('b', 2)],
      }),
    )

    // Parking runs first, before any row is rewritten.
    expect(statements[0]).toContain('created_order = -1 - created_order')
    const updates = statements.filter((s) => s.startsWith('UPDATE session_nodes SET parent_id'))
    expect(updates).toHaveLength(2)
    expect(updates.every((s) => s.includes('created_order = ?'))).toBe(true)
  })
})

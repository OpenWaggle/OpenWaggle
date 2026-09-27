import type * as SqlClient from '@effect/sql/SqlClient'
import * as Effect from 'effect/Effect'
import type {
  PersistSessionSnapshotInput,
  ProjectedSessionNodeInput,
} from '../../ports/session-repository'
import { nodeProjectionChanged, searchProjectionChanged } from './snapshot-transcript-term-changes'
import type { SessionNodeRow } from './types'

/** Rewrites a Session's node rows to match a snapshot: update, park, delete and insert. */
export interface NodeReconciliationInput {
  readonly branchHintByNodeId: ReadonlyMap<string, string>
  readonly existingNodes: readonly SessionNodeRow[]
  readonly input: Pick<PersistSessionSnapshotInput, 'sessionId'>
  readonly nodes: readonly ProjectedSessionNodeInput[]
  readonly sql: SqlClient.SqlClient
}

function projectedNode(input: NodeReconciliationInput, node: ProjectedSessionNodeInput) {
  return {
    parentId: node.parentId,
    piEntryType: node.piEntryType,
    kind: node.kind,
    role: node.role,
    timestampMs: node.timestampMs,
    contentJson: node.contentJson,
    metadataJson: node.metadataJson,
    branchHintId: input.branchHintByNodeId.get(node.id) ?? null,
    pathDepth: node.pathDepth,
    createdOrder: node.createdOrder,
  }
}

function updateSnapshotNode(input: {
  readonly sql: SqlClient.SqlClient
  readonly nodeId: string
  readonly next: ReturnType<typeof projectedNode>
  readonly updateSearchProjection: boolean
}) {
  if (!input.updateSearchProjection) {
    return input.sql`
      UPDATE session_nodes SET
        parent_id = ${input.next.parentId}, pi_entry_type = ${input.next.piEntryType},
        timestamp_ms = ${input.next.timestampMs},
        metadata_json = ${input.next.metadataJson}, branch_hint_id = ${input.next.branchHintId},
        path_depth = ${input.next.pathDepth}
      WHERE id = ${input.nodeId}
    `
  }
  return input.sql`
    UPDATE session_nodes SET
      parent_id = ${input.next.parentId}, pi_entry_type = ${input.next.piEntryType},
      kind = ${input.next.kind}, role = ${input.next.role},
      timestamp_ms = ${input.next.timestampMs}, content_json = ${input.next.contentJson},
      metadata_json = ${input.next.metadataJson}, branch_hint_id = ${input.next.branchHintId},
      path_depth = ${input.next.pathDepth}, created_order = ${input.next.createdOrder}
    WHERE id = ${input.nodeId}
  `
}

/**
 * Existing nodes that must leave their `created_order` slot before any row is rewritten: retained
 * nodes that move, and removed nodes whose slot a snapshot node claims.
 *
 * SQLite checks `UNIQUE (session_id, created_order)` row by row, so shifting a run of nodes in
 * place collides with a node that has not moved yet. Durable agent-loop nodes are renumbered after
 * the Pi entries on every snapshot, which shifts them whenever a turn adds entries.
 */
function nodesToPark(input: NodeReconciliationInput) {
  const nextOrderById = new Map(input.nodes.map((node) => [node.id, node.createdOrder]))
  const claimedOrders = new Set(input.nodes.map((node) => node.createdOrder))
  return input.existingNodes
    .filter((existing) => {
      const nextOrder = nextOrderById.get(existing.id)
      return nextOrder === undefined
        ? claimedOrders.has(existing.created_order)
        : nextOrder !== existing.created_order
    })
    .map((existing) => existing.id)
}

/** Moves nodes to distinct negative orders, which no snapshot claims, in one statement. */
function parkNodeOrders(sql: SqlClient.SqlClient, nodeIds: readonly string[]) {
  if (nodeIds.length === 0) return Effect.void
  return sql`
    UPDATE session_nodes SET created_order = -1 - created_order
    WHERE id IN (SELECT CAST(value AS TEXT) FROM json_each(${JSON.stringify(nodeIds)}))
  `
}

export function reconcileSnapshotNodes(input: NodeReconciliationInput) {
  return Effect.gen(function* () {
    const existingById = new Map(input.existingNodes.map((node) => [node.id, node]))
    const retainedIds = new Set(input.nodes.map((node) => node.id))

    // Parked, not deleted first: deleting cascades to children that are only re-parented below.
    yield* parkNodeOrders(input.sql, nodesToPark(input))
    for (const node of input.nodes) {
      const existing = existingById.get(node.id)
      if (!existing) continue
      const next = projectedNode(input, node)
      if (!nodeProjectionChanged(existing, next)) continue
      yield* updateSnapshotNode({
        sql: input.sql,
        nodeId: node.id,
        next,
        updateSearchProjection: searchProjectionChanged(existing, next),
      })
    }
    for (const existing of input.existingNodes) {
      if (!retainedIds.has(existing.id)) {
        yield* input.sql`DELETE FROM session_nodes WHERE id = ${existing.id}`
      }
    }
    for (const node of input.nodes) {
      if (existingById.has(node.id)) continue
      yield* insertSnapshotNode({
        sql: input.sql,
        sessionId: input.input.sessionId,
        branchHintByNodeId: input.branchHintByNodeId,
        node,
      })
    }
  })
}

function insertSnapshotNode(input: {
  readonly sql: SqlClient.SqlClient
  readonly sessionId: PersistSessionSnapshotInput['sessionId']
  readonly branchHintByNodeId: ReadonlyMap<string, string>
  readonly node: ProjectedSessionNodeInput
}) {
  return input.sql`
    INSERT INTO session_nodes (
      id, session_id, parent_id, pi_entry_type, kind, role, timestamp_ms, content_json,
      metadata_json, branch_hint_id, path_depth, created_order
    )
    VALUES (
      ${input.node.id}, ${input.sessionId}, ${input.node.parentId}, ${input.node.piEntryType},
      ${input.node.kind}, ${input.node.role}, ${input.node.timestampMs}, ${input.node.contentJson},
      ${input.node.metadataJson}, ${input.branchHintByNodeId.get(input.node.id) ?? null},
      ${input.node.pathDepth}, ${input.node.createdOrder}
    )
  `
}

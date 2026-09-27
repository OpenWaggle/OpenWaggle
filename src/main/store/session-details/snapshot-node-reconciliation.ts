import type * as SqlClient from '@effect/sql/SqlClient'
import * as Effect from 'effect/Effect'
import type {
  PersistSessionSnapshotInput,
  ProjectedSessionNodeInput,
} from '../../ports/session-repository'
import { nodeProjectionChanged, searchProjectionChanged } from './snapshot-transcript-term-changes'
import type { SessionNodeRow } from './types'

/**
 * Rewrites a Session's node rows to match a snapshot. The order of work is the point of this
 * module: park moving rows, update, delete, then insert.
 *
 * `created_order` is unique per Session, and SQLite checks that index row by row, so rows cannot be
 * shifted in place. Snapshots renumber durable agent-loop nodes after the Pi entries on every
 * turn, and a Pi compaction can shrink the entry count, so runs of rows move together. Deletes run
 * after updates because `parent_id` is `ON DELETE CASCADE`: deleting first would take a retained
 * child that is only re-parented below. Inserts run last, so a snapshot that re-parents a retained
 * node onto a node it also inserts still fails with a foreign-key error; Pi's append-only
 * projection never produces that shape.
 */
export interface NodeReconciliationInput {
  readonly branchHintByNodeId: ReadonlyMap<string, string>
  readonly existingNodes: readonly SessionNodeRow[]
  readonly nodes: readonly ProjectedSessionNodeInput[]
  readonly sessionId: PersistSessionSnapshotInput['sessionId']
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
 * nodes that move, and removed nodes whose slot a snapshot node claims. A parked node is always
 * written back through the full update below, so its final `created_order` is restored.
 */
export function nodesToPark(input: {
  readonly existingNodes: readonly SessionNodeRow[]
  readonly nodes: readonly ProjectedSessionNodeInput[]
}) {
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

/**
 * Moves nodes to distinct negative orders, which no snapshot claims, in one statement. `-1 -
 * created_order` is an involution, so it is injective on its own; the `created_order >= 0` guard is
 * what keeps a parked row off a positive slot a live row still holds. It also means `session_nodes`
 * can never carry a `CHECK (created_order >= 0)`.
 */
function parkNodeOrders(sql: SqlClient.SqlClient, nodeIds: readonly string[]) {
  if (nodeIds.length === 0) return Effect.void
  return sql`
    UPDATE session_nodes SET created_order = -1 - created_order
    WHERE created_order >= 0
      AND id IN (SELECT CAST(value AS TEXT) FROM json_each(${JSON.stringify(nodeIds)}))
  `
}

/** Describes the first snapshot order that would break parking, or null when the snapshot is valid. */
function describeUnparkableOrder(nodes: readonly ProjectedSessionNodeInput[]) {
  const seen = new Set<number>()
  for (const node of nodes) {
    if (node.createdOrder < 0) return `node ${node.id} has a negative created_order`
    if (seen.has(node.createdOrder)) return `duplicate created_order at node ${node.id}`
    seen.add(node.createdOrder)
  }
  return null
}

/**
 * Rewrites a Session's node rows to match a snapshot, in phase order: park moving rows, update,
 * delete, insert. See {@link NodeReconciliationInput} for why that order matters. Callers that do
 * not go through `repositoryOperation` (the fork lifecycle path) see the invalid-order guard below
 * as a defect rather than a typed `SessionProjectionRepositoryError`; the transaction still rolls
 * back and the request still fails, and Pi's append-only projection never produces such a snapshot.
 */
export function reconcileSnapshotNodes(input: NodeReconciliationInput) {
  return Effect.gen(function* () {
    const existingById = new Map(input.existingNodes.map((node) => [node.id, node]))
    const retainedIds = new Set(input.nodes.map((node) => node.id))
    // A duplicate or negative order would corrupt orders rather than fail loudly; name the node.
    const orderProblem = describeUnparkableOrder(input.nodes)
    if (orderProblem) {
      yield* Effect.dieMessage(`reconcileSnapshotNodes (${input.sessionId}): ${orderProblem}`)
    }

    const parkedIds = nodesToPark(input)
    const parked = new Set(parkedIds)
    yield* parkNodeOrders(input.sql, parkedIds)
    for (const node of input.nodes) {
      const existing = existingById.get(node.id)
      if (!existing) continue
      const next = projectedNode(input, node)
      // A parked row must be written back with its final created_order, which only the full update
      // includes; force it rather than trusting searchProjectionChanged to compare created_order.
      const restoreParkedOrder = parked.has(node.id)
      if (!restoreParkedOrder && !nodeProjectionChanged(existing, next)) continue
      yield* updateSnapshotNode({
        sql: input.sql,
        nodeId: node.id,
        next,
        updateSearchProjection: restoreParkedOrder || searchProjectionChanged(existing, next),
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
        sessionId: input.sessionId,
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

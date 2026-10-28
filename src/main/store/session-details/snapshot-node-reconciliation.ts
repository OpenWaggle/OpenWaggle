import type * as SqlClient from '@effect/sql/SqlClient'
import * as Effect from 'effect/Effect'
import type {
  PersistSessionSnapshotInput,
  ProjectedSessionNodeInput,
} from '../../ports/session-repository'
import { makeEventLoopSlicer } from '../../utils/event-loop-slice'
import { sessionNodeContentHash } from './node-content-hash'
import { nodeProjectionChanged, searchProjectionChanged } from './snapshot-transcript-term-changes'
import type { ComparedSessionNodeRow, SessionNodeShapeRow } from './types'

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
  /** `sessionNodeContentHash` of the snapshot's nodes, which each node write stores with it. */
  readonly contentHashByNodeId: ReadonlyMap<string, string>
  readonly existingNodes: readonly ComparedSessionNodeRow[]
  readonly nodes: readonly ProjectedSessionNodeInput[]
  /**
   * Snapshot nodes kept from the Session's current Pi projection (D6): their content and metadata
   * are stored as they are, so they are never read, hashed or written; only their place in the
   * tree (branch hint, parent, depth, order) is brought up to date.
   */
  readonly retainedIds: ReadonlySet<string>
  readonly sessionId: PersistSessionSnapshotInput['sessionId']
  readonly sql: SqlClient.SqlClient
}

function contentHashOf(input: NodeReconciliationInput, node: ProjectedSessionNodeInput) {
  return (
    input.contentHashByNodeId.get(node.id) ??
    sessionNodeContentHash(node.contentJson, node.metadataJson)
  )
}

/** The values a node write stores; content, metadata and digest are read only when written. */
function projectedNode(input: NodeReconciliationInput, node: ProjectedSessionNodeInput) {
  return {
    get contentHash() {
      return contentHashOf(input, node)
    },
    parentId: node.parentId,
    piEntryType: node.piEntryType,
    kind: node.kind,
    role: node.role,
    timestampMs: node.timestampMs,
    get contentJson() {
      return node.contentJson
    },
    get metadataJson() {
      return node.metadataJson
    },
    branchHintId: input.branchHintByNodeId.get(node.id) ?? null,
    pathDepth: node.pathDepth,
    createdOrder: node.createdOrder,
  }
}

/**
 * Brings a kept node's place in the tree up to date without touching its content (D6). Its order
 * is written only when it moves, since the search triggers rebuild a row whose order is written.
 */
function updateRetainedNodeShape(input: {
  readonly sql: SqlClient.SqlClient
  readonly sessionId: PersistSessionSnapshotInput['sessionId']
  readonly nodeId: string
  readonly next: ReturnType<typeof projectedNode>
  readonly writeOrder: boolean
}) {
  if (!input.writeOrder) {
    return input.sql`
      UPDATE session_nodes SET
        parent_id = ${input.next.parentId}, pi_entry_type = ${input.next.piEntryType},
        timestamp_ms = ${input.next.timestampMs}, branch_hint_id = ${input.next.branchHintId},
        path_depth = ${input.next.pathDepth}
      WHERE id = ${input.nodeId} AND session_id = ${input.sessionId}
    `
  }
  return input.sql`
    UPDATE session_nodes SET
      parent_id = ${input.next.parentId}, pi_entry_type = ${input.next.piEntryType},
      timestamp_ms = ${input.next.timestampMs}, branch_hint_id = ${input.next.branchHintId},
      path_depth = ${input.next.pathDepth}, created_order = ${input.next.createdOrder}
    WHERE id = ${input.nodeId} AND session_id = ${input.sessionId}
  `
}

function updateSnapshotNode(input: {
  readonly sql: SqlClient.SqlClient
  readonly sessionId: PersistSessionSnapshotInput['sessionId']
  readonly nodeId: string
  readonly next: ReturnType<typeof projectedNode>
  readonly updateSearchProjection: boolean
}) {
  if (!input.updateSearchProjection) {
    return input.sql`
      UPDATE session_nodes SET
        parent_id = ${input.next.parentId}, pi_entry_type = ${input.next.piEntryType},
        timestamp_ms = ${input.next.timestampMs},
        metadata_json = ${input.next.metadataJson}, content_hash = ${input.next.contentHash},
        branch_hint_id = ${input.next.branchHintId}, path_depth = ${input.next.pathDepth}
      WHERE id = ${input.nodeId} AND session_id = ${input.sessionId}
    `
  }
  return input.sql`
    UPDATE session_nodes SET
      parent_id = ${input.next.parentId}, pi_entry_type = ${input.next.piEntryType},
      kind = ${input.next.kind}, role = ${input.next.role},
      timestamp_ms = ${input.next.timestampMs}, content_json = ${input.next.contentJson},
      metadata_json = ${input.next.metadataJson}, content_hash = ${input.next.contentHash},
      branch_hint_id = ${input.next.branchHintId}, path_depth = ${input.next.pathDepth},
      created_order = ${input.next.createdOrder}
    WHERE id = ${input.nodeId} AND session_id = ${input.sessionId}
  `
}

/**
 * Existing nodes that must leave their `created_order` slot before any row is rewritten: retained
 * nodes that move, and removed nodes whose slot a snapshot node claims. A parked node is always
 * written back through the full update below, so its final `created_order` is restored.
 */
export function nodesToPark(input: {
  readonly existingNodes: readonly Pick<SessionNodeShapeRow, 'id' | 'created_order'>[]
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
function parkNodeOrders(
  sql: SqlClient.SqlClient,
  sessionId: PersistSessionSnapshotInput['sessionId'],
  nodeIds: readonly string[],
) {
  if (nodeIds.length === 0) return Effect.void
  return sql`
    UPDATE session_nodes SET created_order = -1 - created_order
    WHERE session_id = ${sessionId} AND created_order >= 0
      AND id IN (SELECT CAST(value AS TEXT) FROM json_each(${JSON.stringify(nodeIds)}))
  `
}

/**
 * Stores the digest of a row stored before digests existed whose content the snapshot left as it
 * was, so the Session's next snapshot compares it by digest (D6). Only the digest changes: no
 * search or export trigger runs for it, and the node-mutation revision does not move (migration
 * 85 limits that trigger to the columns a reader sees).
 */
function backfillContentHash(
  sql: SqlClient.SqlClient,
  sessionId: PersistSessionSnapshotInput['sessionId'],
  nodeId: string,
  contentHash: string,
) {
  return sql`
    UPDATE session_nodes SET content_hash = ${contentHash}
    WHERE id = ${nodeId} AND session_id = ${sessionId} AND content_hash IS NULL
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
 * Writes what changed of a node the Session already holds, returning whether anything was written.
 * A parked row must be written back with its final created_order, which only the full update
 * includes; it is forced rather than trusting searchProjectionChanged to compare created_order.
 */
function rewriteExistingNode(
  input: NodeReconciliationInput,
  existing: ComparedSessionNodeRow,
  node: ProjectedSessionNodeInput,
  restoreParkedOrder: boolean,
) {
  return Effect.gen(function* () {
    const next = projectedNode(input, node)
    const changed = restoreParkedOrder || nodeProjectionChanged(existing, next)
    if (input.retainedIds.has(node.id)) {
      if (!changed) return false
      yield* updateRetainedNodeShape({
        sql: input.sql,
        sessionId: input.sessionId,
        nodeId: node.id,
        next,
        writeOrder: restoreParkedOrder || existing.created_order !== next.createdOrder,
      })
      return true
    }
    if (!changed) {
      if (existing.content_hash !== null) return false
      yield* backfillContentHash(input.sql, input.sessionId, node.id, next.contentHash)
      return true
    }
    yield* updateSnapshotNode({
      sql: input.sql,
      sessionId: input.sessionId,
      nodeId: node.id,
      next,
      updateSearchProjection: restoreParkedOrder || searchProjectionChanged(existing, next),
    })
    return true
  })
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
    const snapshotIds = new Set(input.nodes.map((node) => node.id))
    // A duplicate or negative order would corrupt orders rather than fail loudly; name the node.
    const orderProblem = describeUnparkableOrder(input.nodes)
    if (orderProblem) {
      yield* Effect.dieMessage(`reconcileSnapshotNodes (${input.sessionId}): ${orderProblem}`)
    }

    // A Run's snapshot can write hundreds of nodes, each through the search triggers.
    const slice = makeEventLoopSlicer()
    const parkedIds = nodesToPark(input)
    const parked = new Set(parkedIds)
    yield* parkNodeOrders(input.sql, input.sessionId, parkedIds)
    for (const node of input.nodes) {
      const existing = existingById.get(node.id)
      if (!existing) continue
      if (yield* rewriteExistingNode(input, existing, node, parked.has(node.id))) yield* slice
    }
    for (const existing of input.existingNodes) {
      if (!snapshotIds.has(existing.id)) {
        yield* input.sql`
          DELETE FROM session_nodes WHERE id = ${existing.id} AND session_id = ${input.sessionId}
        `
        yield* slice
      }
    }
    for (const node of input.nodes) {
      if (existingById.has(node.id)) continue
      yield* insertSnapshotNode({
        sql: input.sql,
        sessionId: input.sessionId,
        branchHintByNodeId: input.branchHintByNodeId,
        contentHash: contentHashOf(input, node),
        node,
      })
      yield* slice
    }
  })
}

function insertSnapshotNode(input: {
  readonly sql: SqlClient.SqlClient
  readonly sessionId: PersistSessionSnapshotInput['sessionId']
  readonly branchHintByNodeId: ReadonlyMap<string, string>
  readonly contentHash: string
  readonly node: ProjectedSessionNodeInput
}) {
  return input.sql`
    INSERT INTO session_nodes (
      id, session_id, parent_id, pi_entry_type, kind, role, timestamp_ms, content_json,
      metadata_json, content_hash, branch_hint_id, path_depth, created_order
    )
    VALUES (
      ${input.node.id}, ${input.sessionId}, ${input.node.parentId}, ${input.node.piEntryType},
      ${input.node.kind}, ${input.node.role}, ${input.node.timestampMs}, ${input.node.contentJson},
      ${input.node.metadataJson}, ${input.contentHash},
      ${input.branchHintByNodeId.get(input.node.id) ?? null},
      ${input.node.pathDepth}, ${input.node.createdOrder}
    )
  `
}

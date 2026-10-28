import * as SqlClient from '@effect/sql/SqlClient'
import { isAgentLoopAuditNode } from '@shared/utils/agent-loop-audit-node'
import * as Effect from 'effect/Effect'
import type {
  PersistSessionSnapshotInput,
  ProjectedSessionNodeInput,
} from '../../ports/session-repository'
import {
  type PiProjectedEntries,
  type PiSessionFileState,
  readPiProjectionFreshnessWithSql,
  recordPiProjectionWithSql,
  statPiSessionFile,
} from '../pi-session-file-freshness'
import { runStoreEffect } from '../store-runtime'
import { deriveBranchHints, deriveSessionBranchesForSnapshot } from './branch-derivation'
import { sessionNodeContentHash } from './node-content-hash'
import { replaceSnapshotProjection } from './persist-snapshot-projection'
import { retainedSnapshotNodeIds } from './retained-snapshot-nodes'
import { assertNoSessionNodeIdConflicts } from './snapshot-node-ownership'
import {
  compareWithStoredNodes,
  loadSnapshotPersistenceState,
  selectExistingVisualizationMetadata,
} from './snapshot-persistence-state'
import {
  inlineVisualizationNodeIds,
  preserveVisualizationOwnership,
} from './visualization-ownership-projection'

/**
 * `retainedIds` are snapshot nodes kept from the Session's current Pi projection, which a caller
 * checked in the same transaction (D6): their stored content is left as it is.
 */
export function persistSessionSnapshotWithSql(
  sql: SqlClient.SqlClient,
  input: PersistSessionSnapshotInput,
  now: number,
  retainedIds: ReadonlySet<string> = new Set(),
) {
  const sortedNodes = [...input.nodes].sort((left, right) => left.createdOrder - right.createdOrder)
  return Effect.gen(function* () {
    const state = yield* loadSnapshotPersistenceState(sql, input)
    // Fail before any write, naming the ids and their owners rather than SQLite's bare
    // `UNIQUE constraint failed: session_nodes.id`. Only ids this Session does not hold yet can
    // belong to another Session.
    const heldIds = new Set(state.existingNodes.map((node) => node.id))
    yield* assertNoSessionNodeIdConflicts(
      sql,
      input.sessionId,
      sortedNodes.filter((node) => !heldIds.has(node.id)).map((node) => node.id),
    )
    // A kept node's stored metadata already names its visualization's owner.
    const visualizationNodeIds = inlineVisualizationNodeIds(
      sortedNodes.filter((node) => !retainedIds.has(node.id)),
    )
    const existingVisualizationMetadata = yield* selectExistingVisualizationMetadata(
      sql,
      input.sessionId,
      [...visualizationNodeIds],
    )
    const nodes = preserveVisualizationOwnership(
      sortedNodes,
      new Map(existingVisualizationMetadata.map((row) => [row.id, row.metadata_json])),
      visualizationNodeIds,
    )
    const contentHashByNodeId = new Map(
      nodes
        .filter((node) => !retainedIds.has(node.id))
        .map((node) => [node.id, sessionNodeContentHash(node.contentJson, node.metadataJson)]),
    )
    const existingNodes = yield* compareWithStoredNodes({
      sql,
      sessionId: input.sessionId,
      existingNodes: state.existingNodes,
      contentHashByNodeId,
    })
    const derived = deriveSessionBranchesForSnapshot({
      sessionId: String(input.sessionId),
      nodes,
      activeNodeId: input.activeNodeId,
      existingBranches: state.existingBranches,
    })
    const branchHintByNodeId = deriveBranchHints({
      branches: derived.branches,
      nodes,
      activeBranchId: derived.activeBranchId,
    })

    yield* replaceSnapshotProjection({
      activeBranchId: derived.activeBranchId,
      activeNodeId: derived.activeNodeId,
      branchHintByNodeId,
      branchIds: new Set(derived.branches.map((branch) => branch.id)),
      branches: derived.branches,
      branchStateById: new Map(
        state.existingBranchStates.map((branchState) => [branchState.branch_id, branchState]),
      ),
      contentHashByNodeId,
      existingActiveRuns: state.existingActiveRuns,
      existingNodes,
      input,
      nodes,
      now,
      retainedIds,
      sql,
    })
  })
}

/**
 * Persists a snapshot with the Pi file state it was read from (ADR 0051). `piFileState` defaults
 * to the file as it is now, which is right after Pi wrote it in the same process.
 */
export function persistPiSessionSnapshotWithSql(
  sql: SqlClient.SqlClient,
  input: PersistSessionSnapshotInput,
  now: number,
  piFileState: PiSessionFileState | null = statPiSessionFile(input.piSessionFile),
) {
  return Effect.gen(function* () {
    // Nodes a Pi projection kept from the Session's current projection are as stored (D6). Every
    // write of an existing Session's nodes goes through here and advances the revision, so a
    // recorded tail at the kept nodes' revision means nothing rewrote them since.
    const projection = yield* readPiProjectionFreshnessWithSql(sql, input.sessionId)
    const retainedIds = projection.tail
      ? retainedSnapshotNodeIds(input.nodes, projection.revision)
      : new Set<string>()
    yield* persistSessionSnapshotWithSql(sql, input, now, retainedIds)
    yield* recordPiProjectionWithSql(
      sql,
      input.sessionId,
      piFileState,
      now,
      projectedPiEntries(input),
    )
  })
}

/**
 * The Pi entries a snapshot holds: every node but OpenWaggle's agent-loop audit nodes, which come
 * after them. Null when their orders are not the entries' indexes, as a Pi projection makes them.
 */
function projectedPiEntries(input: PersistSessionSnapshotInput): PiProjectedEntries | null {
  const entries: ProjectedSessionNodeInput[] = input.nodes.filter(
    (node) => !isAgentLoopAuditNode(node),
  )
  const last = entries.reduce<ProjectedSessionNodeInput | undefined>(
    (latest, node) => (!latest || node.createdOrder > latest.createdOrder ? node : latest),
    undefined,
  )
  if (!last || last.createdOrder !== entries.length - 1) return null
  return {
    entryCount: entries.length,
    lastNodeId: last.id,
    leafNodeId: input.activeNodeId,
    projectionVersion: input.piProjection?.version ?? null,
  }
}

export async function persistSessionSnapshot(input: PersistSessionSnapshotInput): Promise<void> {
  const now = Date.now()

  await runStoreEffect(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      yield* sql.withTransaction(persistPiSessionSnapshotWithSql(sql, input, now))
    }),
  )
}

import * as SqlClient from '@effect/sql/SqlClient'
import * as Effect from 'effect/Effect'
import type { PersistSessionSnapshotInput } from '../../ports/session-repository'
import {
  type PiSessionFileState,
  recordPiProjectionWithSql,
  statPiSessionFile,
} from '../pi-session-file-freshness'
import { runStoreEffect } from '../store-runtime'
import { deriveBranchHints, deriveSessionBranchesForSnapshot } from './branch-derivation'
import { sessionNodeContentHash } from './node-content-hash'
import { replaceSnapshotProjection } from './persist-snapshot-projection'
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

export function persistSessionSnapshotWithSql(
  sql: SqlClient.SqlClient,
  input: PersistSessionSnapshotInput,
  now: number,
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
    const visualizationNodeIds = inlineVisualizationNodeIds(sortedNodes)
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
      nodes.map((node) => [node.id, sessionNodeContentHash(node.contentJson, node.metadataJson)]),
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
    yield* persistSessionSnapshotWithSql(sql, input, now)
    yield* recordPiProjectionWithSql(sql, input.sessionId, piFileState, now)
  })
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

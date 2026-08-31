import * as SqlClient from '@effect/sql/SqlClient'
import * as Effect from 'effect/Effect'
import type { PersistSessionSnapshotInput } from '../../ports/session-repository'
import { runStoreEffect } from '../store-runtime'
import { deriveBranchHints, deriveSessionBranchesForSnapshot } from './branch-derivation'
import {
  loadSnapshotPersistenceState,
  replaceSnapshotProjection,
} from './persist-snapshot-projection'

export function persistSessionSnapshotWithSql(
  sql: SqlClient.SqlClient,
  input: PersistSessionSnapshotInput,
  now: number,
) {
  const nodes = [...input.nodes].sort((left, right) => left.createdOrder - right.createdOrder)
  return Effect.gen(function* () {
    const state = yield* loadSnapshotPersistenceState(sql, input)
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
      existingActiveRuns: state.existingActiveRuns,
      input,
      nodes,
      now,
      sql,
    })
  })
}

export async function persistSessionSnapshot(input: PersistSessionSnapshotInput): Promise<void> {
  const now = Date.now()

  await runStoreEffect(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      yield* sql.withTransaction(persistSessionSnapshotWithSql(sql, input, now))
    }),
  )
}

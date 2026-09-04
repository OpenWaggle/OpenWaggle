import type * as SqlClient from '@effect/sql/SqlClient'
import * as Effect from 'effect/Effect'
import type {
  PersistSessionSnapshotInput,
  ProjectedSessionNodeInput,
} from '../../ports/session-repository'
import { getBranchStateValue } from './branch-state'
import {
  EXPANDED_NODE_IDS_DEFAULT_JSON,
  EXPANDED_NODE_IDS_UNTOUCHED,
  TREE_SIDEBAR_EXPANDED,
} from './constants'
import { latestModeStateForActiveNode, latestModeStateForBranch } from './mode-state-projection'
import type { DerivedSessionBranch, SessionActiveRunRow, SessionBranchStateRow } from './types'

export interface SnapshotProjectionInput {
  readonly activeBranchId: string
  readonly activeNodeId: string | null
  readonly branchHintByNodeId: ReadonlyMap<string, string>
  readonly branchIds: ReadonlySet<string>
  readonly branches: readonly DerivedSessionBranch[]
  readonly branchStateById: ReadonlyMap<string, SessionBranchStateRow>
  readonly existingActiveRuns: readonly SessionActiveRunRow[]
  readonly input: PersistSessionSnapshotInput
  readonly nodes: readonly ProjectedSessionNodeInput[]
  readonly now: number
  readonly sql: SqlClient.SqlClient
}

function deleteSnapshotProjection(
  sql: SqlClient.SqlClient,
  sessionId: PersistSessionSnapshotInput['sessionId'],
) {
  return Effect.gen(function* () {
    yield* sql`DELETE FROM session_active_runs WHERE session_id = ${sessionId}`
    yield* sql`
      DELETE FROM session_branch_state
      WHERE branch_id IN (SELECT id FROM session_branches WHERE session_id = ${sessionId})
    `
    yield* sql`DELETE FROM session_branches WHERE session_id = ${sessionId}`
    yield* sql`DELETE FROM session_nodes WHERE session_id = ${sessionId}`
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

function insertSnapshotBranch(input: {
  readonly sql: SqlClient.SqlClient
  readonly sessionId: PersistSessionSnapshotInput['sessionId']
  readonly branch: DerivedSessionBranch
  readonly now: number
}) {
  return input.sql`
    INSERT INTO session_branches (
      id, session_id, source_node_id, head_node_id, name, is_main, archived_at, created_at, updated_at
    )
    VALUES (
      ${input.branch.id}, ${input.sessionId}, ${input.branch.sourceNodeId}, ${input.branch.headNodeId},
      ${input.branch.name}, ${input.branch.isMain ? 1 : 0}, ${input.branch.archivedAt},
      ${input.branch.createdAt}, ${input.now}
    )
  `
}

function insertSnapshotBranchState(input: {
  readonly sql: SqlClient.SqlClient
  readonly branch: DerivedSessionBranch
  readonly activeBranchId: string
  readonly branchStateById: ReadonlyMap<string, SessionBranchStateRow>
  readonly nodeById: ReadonlyMap<string, ProjectedSessionNodeInput>
  readonly now: number
  readonly snapshot: PersistSessionSnapshotInput
}) {
  const branchState = getBranchStateValue({
    branch: input.branch,
    activeBranchId: input.activeBranchId,
    modeState: latestModeStateForBranch({ branch: input.branch, nodeById: input.nodeById }),
    waggleConfig: input.snapshot.waggleConfig,
    existingState: input.branchStateById.get(input.branch.id),
    now: input.now,
  })

  return input.sql`
    INSERT INTO session_branch_state (
      branch_id, future_mode, waggle_preset_id, waggle_config_json, last_active_at, ui_state_json
    )
    VALUES (
      ${input.branch.id}, ${branchState.futureMode}, ${branchState.wagglePresetId},
      ${branchState.waggleConfigJson}, ${branchState.lastActiveAt}, ${branchState.uiStateJson}
    )
  `
}

function restoreActiveRun(sql: SqlClient.SqlClient, activeRun: SessionActiveRunRow) {
  return sql`
    INSERT INTO session_active_runs (
      run_id, session_id, branch_id, run_mode, status, runtime_json, updated_at
    )
    VALUES (
      ${activeRun.run_id}, ${activeRun.session_id}, ${activeRun.branch_id}, ${activeRun.run_mode},
      ${activeRun.status}, ${activeRun.runtime_json}, ${activeRun.updated_at}
    )
  `
}

function upsertTreeUiState(
  sql: SqlClient.SqlClient,
  input: PersistSessionSnapshotInput,
  now: number,
) {
  return sql`
    INSERT INTO session_tree_ui_state (
      session_id, expanded_node_ids_json, expanded_node_ids_touched, branches_sidebar_collapsed, updated_at
    )
    VALUES (
      ${input.sessionId}, ${EXPANDED_NODE_IDS_DEFAULT_JSON}, ${EXPANDED_NODE_IDS_UNTOUCHED},
      ${TREE_SIDEBAR_EXPANDED}, ${now}
    )
    ON CONFLICT(session_id) DO UPDATE SET updated_at = excluded.updated_at
  `
}

function resolveSessionWaggleConfigJson(input: {
  readonly inputConfig: PersistSessionSnapshotInput['waggleConfig']
  readonly activeModeState: ReturnType<typeof latestModeStateForActiveNode>
}) {
  if (input.inputConfig) {
    return { shouldUpdate: true, value: JSON.stringify(input.inputConfig) }
  }
  if (input.activeModeState?.enabled && input.activeModeState.config) {
    return { shouldUpdate: true, value: JSON.stringify(input.activeModeState.config) }
  }
  if (input.activeModeState && !input.activeModeState.enabled) {
    return { shouldUpdate: true, value: null }
  }
  return { shouldUpdate: false, value: null }
}

function updateSnapshotSessionMetadata(input: SnapshotProjectionInput) {
  const nodeById = new Map(input.nodes.map((node) => [node.id, node]))
  const activeModeState = latestModeStateForActiveNode({
    activeNodeId: input.activeNodeId,
    nodeById,
  })
  const nextWaggleConfigJson = resolveSessionWaggleConfigJson({
    inputConfig: input.input.waggleConfig,
    activeModeState,
  })

  return input.sql`
    UPDATE sessions
    SET pi_session_id = ${input.input.piSessionId},
        pi_session_file = ${input.input.piSessionFile ?? null},
        waggle_config_json = CASE
          WHEN ${nextWaggleConfigJson.shouldUpdate ? 1 : 0} = 1 THEN ${nextWaggleConfigJson.value}
          ELSE waggle_config_json
        END,
        updated_at = ${input.now},
        last_active_node_id = ${input.activeNodeId},
        last_active_branch_id = ${input.activeBranchId}
    WHERE id = ${input.input.sessionId}
  `
}

export function replaceSnapshotProjection(input: SnapshotProjectionInput) {
  return Effect.gen(function* () {
    const nodeById = new Map(input.nodes.map((node) => [node.id, node]))
    yield* deleteSnapshotProjection(input.sql, input.input.sessionId)
    for (const node of input.nodes) {
      yield* insertSnapshotNode({
        sql: input.sql,
        sessionId: input.input.sessionId,
        branchHintByNodeId: input.branchHintByNodeId,
        node,
      })
    }
    for (const branch of input.branches) {
      yield* insertSnapshotBranch({
        sql: input.sql,
        sessionId: input.input.sessionId,
        branch,
        now: input.now,
      })
      yield* insertSnapshotBranchState({
        sql: input.sql,
        branch,
        activeBranchId: input.activeBranchId,
        branchStateById: input.branchStateById,
        nodeById,
        now: input.now,
        snapshot: input.input,
      })
    }
    for (const activeRun of input.existingActiveRuns) {
      if (input.branchIds.has(activeRun.branch_id)) yield* restoreActiveRun(input.sql, activeRun)
    }
    yield* upsertTreeUiState(input.sql, input.input, input.now)
    yield* updateSnapshotSessionMetadata(input)
  })
}

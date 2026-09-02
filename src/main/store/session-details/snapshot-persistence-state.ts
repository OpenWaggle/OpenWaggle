import type * as SqlClient from '@effect/sql/SqlClient'
import * as Effect from 'effect/Effect'
import type { PersistSessionSnapshotInput } from '../../ports/session-repository'
import { EMPTY_INDEX } from './constants'
import type {
  SessionActiveRunRow,
  SessionBranchRow,
  SessionBranchStateRow,
  SessionRow,
} from './types'
import { VISUALIZE_REFERENCE_START } from './visualization-ownership-projection'

interface ExistingVisualizationMetadataRow {
  readonly id: string
  readonly metadata_json: string
}

function selectSessionRow(
  sql: SqlClient.SqlClient,
  sessionId: PersistSessionSnapshotInput['sessionId'],
) {
  return sql<SessionRow>`
    SELECT
      id, pi_session_id, pi_session_file, project_path, title, archived, waggle_config_json,
      created_at, updated_at, last_active_node_id, last_active_branch_id
    FROM sessions
    WHERE id = ${sessionId}
    LIMIT 1
  `
}

function selectExistingBranches(
  sql: SqlClient.SqlClient,
  sessionId: PersistSessionSnapshotInput['sessionId'],
) {
  return sql<SessionBranchRow>`
    SELECT id, session_id, source_node_id, head_node_id, name, is_main, archived_at, created_at, updated_at
    FROM session_branches
    WHERE session_id = ${sessionId}
  `
}

function selectExistingBranchStates(
  sql: SqlClient.SqlClient,
  existingBranches: readonly SessionBranchRow[],
) {
  if (existingBranches.length === 0) {
    return Effect.succeed<readonly SessionBranchStateRow[]>([])
  }
  return sql<SessionBranchStateRow>`
    SELECT branch_id, future_mode, waggle_preset_id, waggle_config_json, last_active_at, ui_state_json
    FROM session_branch_state
    WHERE branch_id IN ${sql.in(existingBranches.map((branch) => branch.id))}
  `
}

function selectExistingActiveRuns(
  sql: SqlClient.SqlClient,
  sessionId: PersistSessionSnapshotInput['sessionId'],
) {
  return sql<SessionActiveRunRow>`
    SELECT run_id, session_id, branch_id, run_mode, status, runtime_json, updated_at
    FROM session_active_runs
    WHERE session_id = ${sessionId}
  `
}

function selectExistingVisualizationMetadata(
  sql: SqlClient.SqlClient,
  sessionId: PersistSessionSnapshotInput['sessionId'],
) {
  return sql<ExistingVisualizationMetadataRow>`
    SELECT id, metadata_json
    FROM session_nodes
    WHERE session_id = ${sessionId}
      AND kind = 'assistant_message'
      AND content_json LIKE ${`%${VISUALIZE_REFERENCE_START}%`}
  `
}

export function loadSnapshotPersistenceState(
  sql: SqlClient.SqlClient,
  input: PersistSessionSnapshotInput,
) {
  return Effect.gen(function* () {
    const sessionRows = yield* selectSessionRow(sql, input.sessionId)
    if (!sessionRows[EMPTY_INDEX]) throw new Error(`Session ${input.sessionId} not found`)
    const existingBranches = yield* selectExistingBranches(sql, input.sessionId)
    const existingBranchStates = yield* selectExistingBranchStates(sql, existingBranches)
    const existingActiveRuns = yield* selectExistingActiveRuns(sql, input.sessionId)
    const existingVisualizationMetadata = yield* selectExistingVisualizationMetadata(
      sql,
      input.sessionId,
    )
    return {
      existingActiveRuns,
      existingBranches,
      existingBranchStates,
      existingVisualizationMetadata,
    }
  })
}

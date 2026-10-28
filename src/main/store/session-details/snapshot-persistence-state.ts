import type * as SqlClient from '@effect/sql/SqlClient'
import { VISUALIZE_REFERENCE_START } from '@shared/utils/inline-visualization'
import * as Effect from 'effect/Effect'
import type { PersistSessionSnapshotInput } from '../../ports/session-repository'
import { yieldToEventLoop } from '../../utils/event-loop-slice'
import { EMPTY_INDEX } from './constants'
import type {
  ComparedSessionNodeRow,
  SessionActiveRunRow,
  SessionBranchRow,
  SessionBranchStateRow,
  SessionNodeRow,
  SessionNodeShapeRow,
  SessionRow,
} from './types'

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

/**
 * The stored metadata of the snapshot's assistant nodes that hold an inline visualization
 * reference, which keeps the Session that owns each visualization (`visualizationSessionId`).
 * Only the snapshot's candidates are looked up, so the Session's content is not scanned.
 */
export function selectExistingVisualizationMetadata(
  sql: SqlClient.SqlClient,
  sessionId: PersistSessionSnapshotInput['sessionId'],
  candidateNodeIds: readonly string[],
) {
  if (candidateNodeIds.length === 0) {
    return Effect.succeed<readonly ExistingVisualizationMetadataRow[]>([])
  }
  return sql<ExistingVisualizationMetadataRow>`
    SELECT id, metadata_json
    FROM session_nodes
    WHERE session_id = ${sessionId}
      AND id IN (SELECT CAST(value AS TEXT) FROM json_each(${JSON.stringify(candidateNodeIds)}))
      AND kind = 'assistant_message'
      AND (
        content_json LIKE ${`%${VISUALIZE_REFERENCE_START}%`} OR
        content_json LIKE '%visualize{%'
      )
  `
}

/** Every column but the content, which `compareWithStoredNodes` reads only where it may differ. */
function selectExistingNodes(
  sql: SqlClient.SqlClient,
  sessionId: PersistSessionSnapshotInput['sessionId'],
) {
  return sql<SessionNodeShapeRow>`
    SELECT id, session_id, parent_id, pi_entry_type, kind, role, timestamp_ms,
      content_hash, branch_hint_id, path_depth, created_order
    FROM session_nodes
    WHERE session_id = ${sessionId}
  `
}

/** Node ids per content read, so one read never holds a large Session's content at once. */
const CONTENT_READ_BATCH_SIZE = 500

function selectNodeContent(
  sql: SqlClient.SqlClient,
  sessionId: PersistSessionSnapshotInput['sessionId'],
  nodeIds: readonly string[],
) {
  return sql<Pick<SessionNodeRow, 'id' | 'content_json' | 'metadata_json'>>`
    SELECT id, content_json, metadata_json
    FROM session_nodes
    WHERE session_id = ${sessionId}
      AND id IN (SELECT CAST(value AS TEXT) FROM json_each(${JSON.stringify(nodeIds)}))
  `
}

/**
 * The Session's stored nodes, ready to compare with a snapshot's: a stored node whose digest equals
 * the snapshot node's is unchanged, so its content is not read (D6). Content is read for the
 * others the snapshot keeps (a changed node, or one stored before digests existed); a node the
 * snapshot drops is deleted whatever it holds, so its content is never read.
 */
export function compareWithStoredNodes(input: {
  readonly sql: SqlClient.SqlClient
  readonly sessionId: PersistSessionSnapshotInput['sessionId']
  readonly existingNodes: readonly SessionNodeShapeRow[]
  readonly contentHashByNodeId: ReadonlyMap<string, string>
}) {
  return Effect.gen(function* () {
    const unknownIds = input.existingNodes
      .filter((node) => {
        const next = input.contentHashByNodeId.get(node.id)
        return next !== undefined && (node.content_hash === null || node.content_hash !== next)
      })
      .map((node) => node.id)
    const contentById = new Map<string, Pick<SessionNodeRow, 'content_json' | 'metadata_json'>>()
    for (let start = 0; start < unknownIds.length; start += CONTENT_READ_BATCH_SIZE) {
      if (start > 0) yield* yieldToEventLoop
      const rows = yield* selectNodeContent(
        input.sql,
        input.sessionId,
        unknownIds.slice(start, start + CONTENT_READ_BATCH_SIZE),
      )
      for (const row of rows) {
        contentById.set(row.id, {
          content_json: row.content_json,
          metadata_json: row.metadata_json,
        })
      }
    }
    return input.existingNodes.map(
      (node): ComparedSessionNodeRow => ({ ...node, content: contentById.get(node.id) ?? null }),
    )
  })
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
    const existingNodes = yield* selectExistingNodes(sql, input.sessionId)
    return { existingActiveRuns, existingBranches, existingBranchStates, existingNodes }
  })
}

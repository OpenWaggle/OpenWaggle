import type * as SqlClient from '@effect/sql/SqlClient'
import type { SessionQueryRequest } from '@shared/types/session-query'
import * as Effect from 'effect/Effect'
import {
  parseSessionJson,
  type SessionQuerySummaryRow,
  sessionQueryResponse,
  sessionQuerySummary,
} from './sqlite-session-query-support'

interface ItemRow {
  readonly id: string
  readonly parent_id: string | null
  readonly role: string | null
  readonly kind: string
  readonly timestamp_ms: number
  readonly created_order: number
  readonly content_json: string
  readonly metadata_json: string
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function runIdFromMetadata(metadata: unknown) {
  if (!isRecord(metadata) || !isRecord(metadata.openWaggle)) return undefined
  const runId = metadata.openWaggle.runId
  return typeof runId === 'string' ? runId : undefined
}

export function readSession(sql: SqlClient.SqlClient, request: SessionQueryRequest) {
  const sessionId = 'sessionId' in request.query ? request.query.sessionId : ''
  return Effect.gen(function* () {
    const rows = yield* sql<
      SessionQuerySummaryRow & {
        workspace_id: string
        workspace_kind: 'local' | 'managed-worktree'
        working_path: string
        lifecycle_state: string
        state_revision: number
        active_run_id: string | null
        active_run_status: string | null
        queue_state: 'running' | 'paused'
        queue_revision: number
        pending_follow_up_count: number
        current_specification_revision: number | null
        latest_submission_revision: number
      }
    >`
      SELECT
        sessions.id AS session_id, sessions.title, sessions.project_path, sessions.archived,
        sessions.created_at, sessions.updated_at,
        session_spawn_lineage.parent_session_id,
        session_spawn_lineage.hive_root_session_id,
        (SELECT COUNT(*) FROM session_spawn_lineage AS direct_lineage
          WHERE direct_lineage.parent_session_id = sessions.id) AS direct_worker_count,
        session_execution_profiles.profile_json,
        delegation_contracts.id AS delegation_id,
        delegation_contracts.state AS delegation_state,
        delegation_contracts.current_specification_revision,
        COALESCE((SELECT MAX(delegation_submissions.revision)
          FROM delegation_submissions
          WHERE delegation_submissions.delegation_id = delegation_contracts.id), 0)
          AS latest_submission_revision,
        session_control_states.state_revision,
        session_control_states.active_run_id,
        active_session_run.status AS active_run_status,
        session_control_states.queue_state,
        session_control_states.queue_revision,
        (SELECT COUNT(*) FROM session_follow_ups
          WHERE session_follow_ups.session_id = sessions.id) AS pending_follow_up_count,
        workspace_resources.id AS workspace_id,
        workspace_resources.kind AS workspace_kind,
        workspace_resources.working_path,
        workspace_resources.lifecycle_state
      FROM sessions
      JOIN session_workspace_bindings ON session_workspace_bindings.session_id = sessions.id
      JOIN workspace_resources ON workspace_resources.id = session_workspace_bindings.workspace_id
      LEFT JOIN session_spawn_lineage ON session_spawn_lineage.child_session_id = sessions.id
      LEFT JOIN session_execution_profiles ON session_execution_profiles.session_id = sessions.id
      LEFT JOIN delegation_contracts ON delegation_contracts.child_session_id = sessions.id
      JOIN session_control_states ON session_control_states.session_id = sessions.id
      LEFT JOIN session_runs AS active_session_run
        ON active_session_run.id = session_control_states.active_run_id
      WHERE sessions.id = ${sessionId}
      LIMIT 1
    `
    const row = rows[0]
    if (!row) {
      return sessionQueryResponse(request, {
        operation: request.query.operation,
        error: { code: 'session_not_found', message: 'Session not found.' },
      })
    }
    return sessionQueryResponse(request, {
      operation: 'read',
      session: sessionQuerySummary(row),
      workspace: {
        workspaceId: row.workspace_id,
        kind: row.workspace_kind,
        workingPath: row.working_path,
        lifecycleState: row.lifecycle_state,
      },
      runtime: {
        stateRevision: row.state_revision,
        activeRunId: row.active_run_id,
        ...(row.active_run_status ? { activeRunStatus: row.active_run_status } : {}),
      },
      queue: {
        state: row.queue_state,
        revision: row.queue_revision,
        pendingCount: row.pending_follow_up_count,
      },
      ...(row.delegation_id && row.delegation_state && row.current_specification_revision
        ? {
            delegation: {
              delegationId: row.delegation_id,
              state: row.delegation_state,
              currentSpecificationRevision: row.current_specification_revision,
              latestSubmissionRevision: row.latest_submission_revision,
            },
          }
        : {}),
    })
  })
}

export function readItems(sql: SqlClient.SqlClient, request: SessionQueryRequest) {
  if (request.query.operation !== 'items') throw new Error('Expected items query.')
  const query = request.query
  return Effect.gen(function* () {
    const sessionRows = yield* sql<{
      readonly session_exists: number
      readonly high_water_mark: number
    }>`
      SELECT EXISTS(SELECT 1 FROM sessions WHERE id = ${query.sessionId}) AS session_exists,
        COALESCE(MAX(created_order), 0) AS high_water_mark
      FROM session_nodes
      WHERE session_id = ${query.sessionId}
    `
    const snapshot = sessionRows[0]
    if (snapshot?.session_exists !== 1) {
      return sessionQueryResponse(request, {
        operation: 'items',
        error: { code: 'session_not_found', message: 'Session not found.' },
      })
    }
    const highWaterMark = query.throughCreatedOrder ?? snapshot.high_water_mark
    const rows = query.runId
      ? yield* sql<ItemRow>`
          SELECT id, parent_id, role, kind, timestamp_ms, created_order, content_json, metadata_json
          FROM session_nodes
          WHERE session_id = ${query.sessionId}
            AND json_extract(metadata_json, '$.openWaggle.runId') = ${query.runId}
            AND created_order > ${query.afterCreatedOrder ?? -1}
            AND created_order <= ${highWaterMark}
          ORDER BY created_order ASC
          LIMIT ${query.limit + 1}
        `
      : yield* sql<ItemRow>`
          SELECT id, parent_id, role, kind, timestamp_ms, created_order, content_json, metadata_json
          FROM session_nodes
          WHERE session_id = ${query.sessionId}
            AND created_order > ${query.afterCreatedOrder ?? -1}
            AND created_order <= ${highWaterMark}
          ORDER BY created_order ASC
          LIMIT ${query.limit + 1}
        `
    const page = rows.slice(0, query.limit)
    const last = page.at(-1)
    return sessionQueryResponse(request, {
      operation: 'items',
      sessionId: query.sessionId,
      highWaterMark,
      items: page.map((row) => {
        const metadata = parseSessionJson(row.metadata_json)
        const runId = runIdFromMetadata(metadata)
        return {
          nodeId: row.id,
          parentNodeId: row.parent_id,
          role: row.role,
          kind: row.kind,
          timestampMs: row.timestamp_ms,
          createdOrder: row.created_order,
          ...(runId ? { runId } : {}),
          content: parseSessionJson(row.content_json),
          metadata,
        }
      }),
      ...(rows.length > query.limit && last ? { nextCreatedOrder: last.created_order } : {}),
    })
  })
}

export function readStatus(sql: SqlClient.SqlClient, request: SessionQueryRequest) {
  if (request.query.operation !== 'status') throw new Error('Expected status query.')
  const query = request.query
  return Effect.gen(function* () {
    const rows = yield* sql<{
      state_revision: number
      queue_state: 'running' | 'paused'
      queue_revision: number
      active_run_id: string | null
      active_run_status: string | null
      pending_follow_up_count: number
    }>`
      SELECT
        session_control_states.state_revision,
        session_control_states.queue_state,
        session_control_states.queue_revision,
        session_control_states.active_run_id,
        session_runs.status AS active_run_status,
        (SELECT COUNT(*) FROM session_follow_ups
          WHERE session_follow_ups.session_id = session_control_states.session_id)
          AS pending_follow_up_count
      FROM session_control_states
      LEFT JOIN session_runs ON session_runs.id = session_control_states.active_run_id
      WHERE session_control_states.session_id = ${query.sessionId}
      LIMIT 1
    `
    const row = rows[0]
    if (!row) {
      return sessionQueryResponse(request, {
        operation: 'status',
        error: { code: 'session_not_found', message: 'Session not found.' },
      })
    }
    return sessionQueryResponse(request, {
      operation: 'status',
      sessionId: query.sessionId,
      stateRevision: row.state_revision,
      queueState: row.queue_state,
      queueRevision: row.queue_revision,
      activeRunId: row.active_run_id,
      ...(row.active_run_status ? { activeRunStatus: row.active_run_status } : {}),
      pendingFollowUpCount: row.pending_follow_up_count,
    })
  })
}

export function readQueue(sql: SqlClient.SqlClient, request: SessionQueryRequest) {
  if (request.query.operation !== 'queue-list') throw new Error('Expected queue-list query.')
  const query = request.query
  return Effect.gen(function* () {
    const states = yield* sql<{
      queue_state: 'running' | 'paused'
      queue_revision: number
      active_run_id: string | null
    }>`
      SELECT queue_state, queue_revision, active_run_id FROM session_control_states
      WHERE session_id = ${query.sessionId} LIMIT 1
    `
    const state = states[0]
    if (!state) {
      return sessionQueryResponse(request, {
        operation: 'queue-list',
        error: { code: 'session_not_found', message: 'Session not found.' },
      })
    }
    const rows = yield* sql<{
      id: string
      position: number
      delivery_state: 'pending' | 'needs_attention'
      attention_reason:
        | 'authorization_ceiling_changed'
        | 'profile_revoked'
        | 'authority_changed'
        | null
      intent_json: string
      created_at: number
    }>`
      SELECT id, position, delivery_state, attention_reason, intent_json, created_at
      FROM session_follow_ups
      WHERE session_id = ${query.sessionId}
      ORDER BY position, id
    `
    return sessionQueryResponse(request, {
      operation: 'queue-list',
      sessionId: query.sessionId,
      queueState: state.queue_state,
      queueRevision: state.queue_revision,
      activeRunId: state.active_run_id,
      items: rows.map((row) => ({
        followUpId: row.id,
        position: row.position,
        createdAt: row.created_at,
        deliveryState: row.delivery_state,
        ...(row.attention_reason ? { attentionReason: row.attention_reason } : {}),
        ...(query.includeBodies ? { intent: parseSessionJson(row.intent_json) } : {}),
      })),
      omittedBodyCount: query.includeBodies ? 0 : rows.length,
    })
  })
}

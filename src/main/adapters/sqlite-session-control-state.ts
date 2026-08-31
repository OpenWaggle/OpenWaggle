import { matchBy } from '@diegogbrisa/ts-match'
import type * as SqlClient from '@effect/sql/SqlClient'
import { decodeUnknownExactOrThrow, parseJsonUnknown, Schema } from '@shared/schema'
import { AGENT_AUTHORIZATION_MODES } from '@shared/types/agent-authorization'
import { FollowUpId, RunId, SessionId } from '@shared/types/brand'
import { THINKING_LEVELS } from '@shared/types/settings'
import * as Effect from 'effect/Effect'
import type {
  SessionControlFollowUp,
  SessionControlIntentSnapshot,
  SessionControlRunState,
  SessionControlSessionState,
} from '../domain/session-control/message-aggregate'
import { SessionControlRepositoryError } from '../errors'

const POSITION_INCREMENT = 1
const EMPTY_QUEUE_POSITION = -1

interface SessionControlStateRow {
  readonly session_id: string
  readonly state_revision: number
  readonly active_run_id: string | null
  readonly queue_state: string
  readonly queue_revision: number
}

interface SessionRunRow {
  readonly id: string
  readonly status: string
  readonly intent_json: string | null
}

interface SessionFollowUpRow {
  readonly id: string
  readonly delivery_state: string
  readonly attention_reason: string | null
  readonly intent_json: string
}

const intentSnapshotSchema: Schema.Schema<SessionControlIntentSnapshot> = Schema.Struct({
  text: Schema.String,
  attachmentIds: Schema.Array(Schema.String),
  thinkingLevel: Schema.optional(Schema.Literal(...THINKING_LEVELS)),
  runAuthorizationOverride: Schema.optional(Schema.Literal(...AGENT_AUTHORIZATION_MODES)),
  interactionTimeoutMs: Schema.optional(Schema.Number.pipe(Schema.int(), Schema.nonNegative())),
  callerId: Schema.String,
  acceptedAt: Schema.Number.pipe(Schema.int(), Schema.nonNegative()),
  idempotencyKey: Schema.String,
})

function repositoryError(operation: string, cause: unknown) {
  return new SessionControlRepositoryError({ operation, cause })
}

function decodeIntent(raw: string) {
  return decodeUnknownExactOrThrow(intentSnapshotSchema, parseJsonUnknown(raw))
}

function decodeQueueState(raw: string): 'running' | 'paused' {
  if (raw === 'running' || raw === 'paused') return raw
  throw new Error(`Invalid Follow-up queue state: ${raw}`)
}

function decodeRun(row: SessionRunRow | undefined): SessionControlRunState {
  if (!row) return { state: 'idle' }
  if (row.status === 'starting') {
    if (row.intent_json === null) throw new Error(`Starting Run ${row.id} has no intent snapshot.`)
    return { state: 'starting', runId: RunId(row.id), intent: decodeIntent(row.intent_json) }
  }
  if (row.status === 'active') return { state: 'active', runId: RunId(row.id) }
  if (row.status === 'stopping') return { state: 'stopping', runId: RunId(row.id) }
  throw new Error(`Invalid active Run status: ${row.status}`)
}

function decodeFollowUp(row: SessionFollowUpRow): SessionControlFollowUp {
  if (row.delivery_state === 'pending' && row.attention_reason === null) {
    return {
      id: FollowUpId(row.id),
      deliveryState: 'pending',
      intent: decodeIntent(row.intent_json),
    }
  }
  if (
    row.delivery_state === 'needs_attention' &&
    (row.attention_reason === 'authorization_ceiling_changed' ||
      row.attention_reason === 'profile_revoked' ||
      row.attention_reason === 'authority_changed')
  ) {
    return {
      id: FollowUpId(row.id),
      deliveryState: 'needs_attention',
      attentionReason: row.attention_reason,
      intent: decodeIntent(row.intent_json),
    }
  }
  throw new Error(
    `Invalid Follow-up delivery state: ${row.delivery_state}/${row.attention_reason ?? 'none'}`,
  )
}

export function loadSessionControlState(sql: SqlClient.SqlClient, sessionId: string) {
  return Effect.gen(function* () {
    const stateRows = yield* sql<SessionControlStateRow>`
      SELECT session_id, state_revision, active_run_id, queue_state, queue_revision
      FROM session_control_states
      WHERE session_id = ${sessionId}
      LIMIT 1
    `
    const stateRow = stateRows[0]
    if (!stateRow) throw new Error(`Session Control state not found for ${sessionId}.`)

    const runRows = stateRow.active_run_id
      ? yield* sql<SessionRunRow>`
          SELECT id, status, intent_json
          FROM session_runs
          WHERE id = ${stateRow.active_run_id}
            AND session_id = ${sessionId}
          LIMIT 1
        `
      : []
    const followUpRows = yield* sql<SessionFollowUpRow>`
      SELECT id, delivery_state, attention_reason, intent_json
      FROM session_follow_ups
      WHERE session_id = ${sessionId}
      ORDER BY position ASC, id ASC
    `

    return yield* Effect.try({
      try: (): SessionControlSessionState => ({
        sessionId: SessionId(stateRow.session_id),
        revision: stateRow.state_revision,
        run: decodeRun(runRows[0]),
        followUpQueue: {
          state: decodeQueueState(stateRow.queue_state),
          revision: stateRow.queue_revision,
          items: followUpRows.map(decodeFollowUp),
        },
      }),
      catch: (cause) => repositoryError('decode-session-state', cause),
    })
  })
}

function persistRun(sql: SqlClient.SqlClient, state: SessionControlSessionState, now: number) {
  return matchBy(state.run, 'state')
    .with('idle', () => Effect.succeed<string | null>(null))
    .with('starting', (run) =>
      sql`
        INSERT INTO session_runs (id, session_id, status, intent_json, created_at, updated_at)
        VALUES (
          ${run.runId},
          ${state.sessionId},
          ${run.state},
          ${JSON.stringify(run.intent)},
          ${now},
          ${now}
        )
        ON CONFLICT(id) DO UPDATE SET
          status = excluded.status,
          intent_json = excluded.intent_json,
          updated_at = excluded.updated_at
      `.pipe(Effect.as(String(run.runId))),
    )
    .with('active', (run) =>
      sql`
        UPDATE session_runs
        SET status = ${run.state}, updated_at = ${now}
        WHERE id = ${run.runId} AND session_id = ${state.sessionId}
      `.pipe(Effect.as(String(run.runId))),
    )
    .with('stopping', (run) =>
      sql`
        UPDATE session_runs
        SET status = ${run.state}, updated_at = ${now}
        WHERE id = ${run.runId} AND session_id = ${state.sessionId}
      `.pipe(Effect.as(String(run.runId))),
    )
    .exhaustive()
}

function persistFollowUps(
  sql: SqlClient.SqlClient,
  state: SessionControlSessionState,
  now: number,
) {
  return Effect.gen(function* () {
    const existingRows = yield* sql<{ readonly id: string; readonly position: number }>`
      SELECT id, position FROM session_follow_ups WHERE session_id = ${state.sessionId}
    `
    const retainedIds = new Set(state.followUpQueue.items.map((item) => String(item.id)))
    for (const existing of existingRows) {
      if (!retainedIds.has(existing.id)) {
        yield* sql`DELETE FROM session_follow_ups WHERE id = ${existing.id}`
      }
    }
    const retainedRows = existingRows.filter((row) => retainedIds.has(row.id))
    if (retainedRows.length > 0) {
      const maximumPosition = Math.max(
        EMPTY_QUEUE_POSITION,
        ...retainedRows.map((row) => row.position),
      )
      const temporaryOffset =
        maximumPosition + state.followUpQueue.items.length + POSITION_INCREMENT
      yield* sql`
        UPDATE session_follow_ups
        SET position = position + ${temporaryOffset}
        WHERE session_id = ${state.sessionId}
      `
    }
    for (const [position, item] of state.followUpQueue.items.entries()) {
      yield* sql`
        INSERT INTO session_follow_ups (
          id, session_id, position, delivery_state, attention_reason,
          intent_json, created_at, updated_at
        )
        VALUES (
          ${item.id},
          ${state.sessionId},
          ${position},
          ${item.deliveryState},
          ${item.attentionReason ?? null},
          ${JSON.stringify(item.intent)},
          ${now},
          ${now}
        )
        ON CONFLICT(id) DO UPDATE SET
          position = excluded.position,
          delivery_state = excluded.delivery_state,
          attention_reason = excluded.attention_reason,
          intent_json = excluded.intent_json,
          updated_at = excluded.updated_at
      `
    }
  })
}

export function persistSessionControlState(
  sql: SqlClient.SqlClient,
  state: SessionControlSessionState,
  now: number,
) {
  return Effect.gen(function* () {
    const activeRunId = yield* persistRun(sql, state, now)
    yield* persistFollowUps(sql, state, now)
    yield* sql`
      UPDATE session_control_states
      SET state_revision = ${state.revision},
          active_run_id = ${activeRunId},
          queue_state = ${state.followUpQueue.state},
          queue_revision = ${state.followUpQueue.revision},
          updated_at = ${now}
      WHERE session_id = ${state.sessionId}
    `
  })
}

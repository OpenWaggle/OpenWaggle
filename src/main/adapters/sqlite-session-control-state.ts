import { matchBy } from '@diegogbrisa/ts-match'
import type * as SqlClient from '@effect/sql/SqlClient'
import { MAX_NODE_TIMER_DELAY_MS } from '@shared/constants/time'
import { decodeUnknownExactOrThrow, parseJsonUnknown, Schema } from '@shared/schema'
import { inlineVisualizationContextSchema } from '@shared/schemas/validation'
import { toWaggleInvocation, waggleInvocationSchema } from '@shared/schemas/waggle'
import { AGENT_AUTHORIZATION_MODES } from '@shared/types/agent-authorization'
import { FollowUpId, RunId, SessionId } from '@shared/types/brand'
import { isFollowUpQueuePauseReason } from '@shared/types/session-control-queue'
import { THINKING_LEVELS } from '@shared/types/settings'
import * as Effect from 'effect/Effect'
import type {
  SessionControlFollowUp,
  SessionControlIntentSnapshot,
  SessionControlRunIntent,
  SessionControlRunState,
  SessionControlSessionState,
} from '../domain/session-control/message-aggregate'
import { SessionControlRepositoryError } from '../errors'
import { monotonicNowMs } from '../utils/monotonic-clock'
import { persistFollowUpEditHolds, withFollowUpEditLeaseState } from './sqlite-follow-up-edit-holds'
import { persistRunStartThinkingLevel } from './sqlite-session-run-start-settings'

const POSITION_INCREMENT = 1
/** The retired Follow-up authorization block's attention reason; such a Follow-up loads as pending. */
const LEGACY_AUTHORIZATION_BLOCK_REASON = 'authorization_ceiling_changed'
const EMPTY_QUEUE_POSITION = -1

interface SessionControlStateRow {
  readonly session_id: string
  readonly state_revision: number
  readonly active_run_id: string | null
  readonly queue_state: string
  readonly queue_revision: number
  readonly queue_pause_reason: string | null
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

const followUpIntentFields = {
  text: Schema.String,
  attachmentIds: Schema.Array(Schema.String),
  waggle: Schema.optional(waggleInvocationSchema),
  visualizationContext: Schema.optional(inlineVisualizationContextSchema),
  interactionTimeoutMs: Schema.optional(
    Schema.Number.pipe(Schema.int(), Schema.between(0, MAX_NODE_TIMER_DELAY_MS)),
  ),
  callerId: Schema.String,
  acceptedAt: Schema.Number.pipe(Schema.int(), Schema.nonNegative()),
  idempotencyKey: Schema.String,
  returnedSteer: Schema.optional(Schema.Struct({ runId: Schema.String })),
}

/**
 * A starting Run's intent: its Follow-up intent snapshot plus the settings it was started with
 * (`thinkingLevel`, `runAuthorizationOverride`), which only a Run started on an idle Session has.
 * A stored Follow-up decodes with the same schema, and `decodeFollowUpIntent` drops those two
 * settings from it. `authorCallerId` is kept: it names who queued a Follow-up the desktop user
 * adopted (`queue-adopt`), for provenance and as the owner of its attachments.
 */
const storedIntentSchema = Schema.Struct({
  ...followUpIntentFields,
  thinkingLevel: Schema.optional(Schema.Literal(...THINKING_LEVELS)),
  runAuthorizationOverride: Schema.optional(Schema.Literal(...AGENT_AUTHORIZATION_MODES)),
  authorCallerId: Schema.optional(Schema.String),
})

function repositoryError(operation: string, cause: unknown) {
  return new SessionControlRepositoryError({ operation, cause })
}

function decodeRunIntent(raw: string): SessionControlRunIntent {
  const decoded = decodeUnknownExactOrThrow(storedIntentSchema, parseJsonUnknown(raw))
  const { waggle, ...intent } = decoded
  return {
    ...intent,
    ...(waggle ? { waggle: toWaggleInvocation(waggle) } : {}),
  }
}

function decodeFollowUpIntent(raw: string): SessionControlIntentSnapshot {
  const {
    thinkingLevel: _thinkingLevel,
    runAuthorizationOverride: _runAuthorizationOverride,
    ...intent
  } = decodeRunIntent(raw)
  return intent
}

function decodeQueueState(raw: string): 'running' | 'paused' {
  if (raw === 'running' || raw === 'paused') return raw
  throw new Error(`Invalid Follow-up queue state: ${raw}`)
}

function decodePauseReason(state: 'running' | 'paused', raw: string | null) {
  if (state === 'running' || raw === null) return {}
  if (isFollowUpQueuePauseReason(raw)) return { pauseReason: raw }
  throw new Error(`Invalid Follow-up queue pause reason: ${raw}`)
}

function decodeRun(row: SessionRunRow | undefined): SessionControlRunState {
  if (!row) return { state: 'idle' }
  if (row.status === 'starting') {
    if (row.intent_json === null) throw new Error(`Starting Run ${row.id} has no intent snapshot.`)
    return { state: 'starting', runId: RunId(row.id), intent: decodeRunIntent(row.intent_json) }
  }
  if (row.status === 'active') return { state: 'active', runId: RunId(row.id) }
  if (row.status === 'stopping') return { state: 'stopping', runId: RunId(row.id) }
  throw new Error(`Invalid active Run status: ${row.status}`)
}

function decodeFollowUp(row: SessionFollowUpRow): SessionControlFollowUp {
  // A Follow-up blocked on an authorization override it no longer carries is simply pending.
  if (
    (row.delivery_state === 'pending' && row.attention_reason === null) ||
    (row.delivery_state === 'needs_attention' &&
      row.attention_reason === LEGACY_AUTHORIZATION_BLOCK_REASON)
  ) {
    return {
      id: FollowUpId(row.id),
      deliveryState: 'pending',
      intent: decodeFollowUpIntent(row.intent_json),
    }
  }
  if (
    row.delivery_state === 'needs_attention' &&
    (row.attention_reason === 'profile_revoked' || row.attention_reason === 'authority_changed')
  ) {
    return {
      id: FollowUpId(row.id),
      deliveryState: 'needs_attention',
      attentionReason: row.attention_reason,
      intent: decodeFollowUpIntent(row.intent_json),
    }
  }
  throw new Error(
    `Invalid Follow-up delivery state: ${row.delivery_state}/${row.attention_reason ?? 'none'}`,
  )
}

export function loadSessionControlState(sql: SqlClient.SqlClient, sessionId: string) {
  return Effect.gen(function* () {
    const stateRows = yield* sql<SessionControlStateRow>`
      SELECT session_id, state_revision, active_run_id, queue_state, queue_revision,
        queue_pause_reason
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

    const state = yield* Effect.try({
      try: (): SessionControlSessionState => {
        const queueState = decodeQueueState(stateRow.queue_state)
        return {
          sessionId: SessionId(stateRow.session_id),
          revision: stateRow.state_revision,
          run: decodeRun(runRows[0]),
          followUpQueue: {
            state: queueState,
            ...decodePauseReason(queueState, stateRow.queue_pause_reason),
            revision: stateRow.queue_revision,
            items: followUpRows.map(decodeFollowUp),
          },
        }
      },
      catch: (cause) => repositoryError('decode-session-state', cause),
    })
    return yield* withFollowUpEditLeaseState(sql, state)
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
    yield* persistRunStartThinkingLevel(sql, state, now)
    yield* persistFollowUps(sql, state, now)
    yield* persistFollowUpEditHolds(sql, state, monotonicNowMs())
    yield* sql`
      UPDATE session_control_states
      SET state_revision = ${state.revision},
          active_run_id = ${activeRunId},
          queue_state = ${state.followUpQueue.state},
          queue_pause_reason = ${
            state.followUpQueue.state === 'paused'
              ? (state.followUpQueue.pauseReason ?? null)
              : null
          },
          queue_revision = ${state.followUpQueue.revision},
          updated_at = ${now}
      WHERE session_id = ${state.sessionId}
    `
  })
}

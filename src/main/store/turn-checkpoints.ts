import { randomUUID } from 'node:crypto'
import * as SqlClient from '@effect/sql/SqlClient'
import type { SessionId } from '@shared/types/brand'
import type { TurnCheckpointSummary, TurnDiff } from '@shared/types/turn-diff'
import {
  parseTurnDiffFilesFromUnifiedDiff,
  sumDeletions,
  sumInsertions,
} from '@shared/utils/turn-diff-parse'
import * as Effect from 'effect/Effect'
import { runStoreEffect } from './store-runtime'

interface TurnCheckpointRow {
  readonly turn_id: string
  readonly turn_index: number
  readonly created_at: number
  readonly diff: string
  readonly insertions: number
  readonly deletions: number
}

export interface RecordTurnCheckpointInput {
  readonly sessionId: SessionId
  readonly turnId: string
  readonly turnIndex: number
  /** The incremental unified diff produced during this turn. */
  readonly diff: string
}

/** Persist a per-turn worktree checkpoint (diff blob) for a session. */
export async function recordTurnCheckpoint(input: RecordTurnCheckpointInput): Promise<void> {
  const files = parseTurnDiffFilesFromUnifiedDiff(input.diff)
  const insertions = sumInsertions(files)
  const deletions = sumDeletions(files)
  await runStoreEffect(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      yield* sql`
        INSERT INTO turn_checkpoints (
          id, session_id, turn_id, turn_index, created_at, diff, insertions, deletions
        )
        VALUES (
          ${randomUUID()}, ${input.sessionId}, ${input.turnId}, ${input.turnIndex},
          ${Date.now()}, ${input.diff}, ${insertions}, ${deletions}
        )
        ON CONFLICT(session_id, turn_id) DO UPDATE SET
          turn_index = excluded.turn_index,
          created_at = excluded.created_at,
          diff = excluded.diff,
          insertions = excluded.insertions,
          deletions = excluded.deletions
      `
    }),
  )
}

/** List checkpoint summaries for a session ordered by turn index. */
export async function listTurnCheckpoints(sessionId: SessionId): Promise<TurnCheckpointSummary[]> {
  return runStoreEffect(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const rows = yield* sql<TurnCheckpointRow>`
        SELECT turn_id, turn_index, created_at, diff, insertions, deletions
        FROM turn_checkpoints
        WHERE session_id = ${sessionId}
        ORDER BY turn_index ASC
      `
      return rows.map((row) => ({
        turnId: row.turn_id,
        turnIndex: row.turn_index,
        createdAt: row.created_at,
        insertions: row.insertions,
        deletions: row.deletions,
      }))
    }),
  )
}

/** Compute the Turn diff for a specific turn from its persisted checkpoint. */
export async function getTurnDiff(sessionId: SessionId, turnId: string): Promise<TurnDiff | null> {
  return runStoreEffect(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const rows = yield* sql<TurnCheckpointRow>`
        SELECT turn_id, turn_index, created_at, diff, insertions, deletions
        FROM turn_checkpoints
        WHERE session_id = ${sessionId} AND turn_id = ${turnId}
        LIMIT 1
      `
      const row = rows[0]
      if (!row) return null
      const files = parseTurnDiffFilesFromUnifiedDiff(row.diff)
      return {
        turnId: row.turn_id,
        diff: row.diff,
        files,
        insertions: row.insertions,
        deletions: row.deletions,
      }
    }),
  )
}

/** Retention: keep only the most recent `maxCheckpoints` turns for a session. */
export async function pruneTurnCheckpoints(
  sessionId: SessionId,
  maxCheckpoints: number,
): Promise<void> {
  await runStoreEffect(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      yield* sql`
        DELETE FROM turn_checkpoints
        WHERE session_id = ${sessionId}
          AND turn_id NOT IN (
            SELECT turn_id FROM turn_checkpoints
            WHERE session_id = ${sessionId}
            ORDER BY turn_index DESC
            LIMIT ${maxCheckpoints}
          )
      `
    }),
  )
}

/** Retention: drop all checkpoints for a session (e.g. on session delete). */
export async function deleteTurnCheckpointsForSession(sessionId: SessionId): Promise<void> {
  await runStoreEffect(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      yield* sql`DELETE FROM turn_checkpoints WHERE session_id = ${sessionId}`
    }),
  )
}

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
  readonly snapshot_ref: string | null
  readonly anchor_node_id: string | null
}

export interface RecordTurnCheckpointInput {
  readonly sessionId: SessionId
  readonly turnId: string
  /** The incremental unified diff produced during this turn. */
  readonly diff: string
  /** Snapshot commit (git stash create) of the worktree at this turn, if any. */
  readonly snapshotRef?: string | null
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
          id, session_id, turn_id, turn_index, created_at, diff, insertions, deletions, snapshot_ref
        )
        SELECT
          ${randomUUID()}, ${input.sessionId}, ${input.turnId},
          (SELECT COALESCE(MAX(turn_index), -1) + 1 FROM turn_checkpoints WHERE session_id = ${input.sessionId}),
          ${Date.now()}, ${input.diff}, ${insertions}, ${deletions}, ${input.snapshotRef ?? null}
        ON CONFLICT(session_id, turn_id) DO UPDATE SET
          created_at = excluded.created_at,
          diff = excluded.diff,
          insertions = excluded.insertions,
          deletions = excluded.deletions,
          snapshot_ref = excluded.snapshot_ref
      `
    }),
  )
}

/** Record the persisted assistant node id a turn's diff is anchored to (for transcript reveal). */
export async function setTurnCheckpointAnchor(
  sessionId: SessionId,
  turnId: string,
  anchorNodeId: string,
): Promise<void> {
  await runStoreEffect(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      yield* sql`
        UPDATE turn_checkpoints
        SET anchor_node_id = ${anchorNodeId}
        WHERE session_id = ${sessionId} AND turn_id = ${turnId}
      `
    }),
  )
}

/** The snapshot ref of the most recent checkpoint for a session, if any. */
export async function getLatestSnapshotRef(sessionId: SessionId): Promise<string | null> {
  return runStoreEffect(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const rows = yield* sql<{ snapshot_ref: string | null }>`
        SELECT snapshot_ref
        FROM turn_checkpoints
        WHERE session_id = ${sessionId}
        ORDER BY turn_index DESC
        LIMIT 1
      `
      return rows[0]?.snapshot_ref ?? null
    }),
  )
}

/** List checkpoint summaries for a session ordered by turn index. */
export async function listTurnCheckpoints(sessionId: SessionId): Promise<TurnCheckpointSummary[]> {
  return runStoreEffect(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const rows = yield* sql<TurnCheckpointRow>`
        SELECT turn_id, turn_index, created_at, diff, insertions, deletions, anchor_node_id
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
        anchorNodeId: row.anchor_node_id ?? null,
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

/**
 * Query by turn range (WS7): merge the diffs of checkpoints whose turn_index is
 * within [fromIndex, toIndex] into a single Turn diff.
 */
export async function getTurnRangeDiff(
  sessionId: SessionId,
  fromIndex: number,
  toIndex: number,
): Promise<TurnDiff | null> {
  return runStoreEffect(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const [low, high] = fromIndex <= toIndex ? [fromIndex, toIndex] : [toIndex, fromIndex]
      const rows = yield* sql<TurnCheckpointRow>`
        SELECT turn_id, turn_index, created_at, diff, insertions, deletions
        FROM turn_checkpoints
        WHERE session_id = ${sessionId} AND turn_index >= ${low} AND turn_index <= ${high}
        ORDER BY turn_index ASC
      `
      if (rows.length === 0) return null
      const diff = rows.map((row) => row.diff).join('\n')
      const files = parseTurnDiffFilesFromUnifiedDiff(diff)
      const lastRow = rows[rows.length - 1]
      return {
        turnId: lastRow?.turn_id ?? '',
        diff,
        files,
        insertions: sumInsertions(files),
        deletions: sumDeletions(files),
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

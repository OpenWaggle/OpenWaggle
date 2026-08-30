import { randomUUID } from 'node:crypto'
import { isMatching, P } from '@diegogbrisa/ts-match'
import * as SqlClient from '@effect/sql/SqlClient'
import { SessionId } from '@shared/types/brand'
import * as Effect from 'effect/Effect'
import { runStoreEffect } from '../store-runtime'
import { EMPTY_INDEX } from './constants'

export type SessionDeletionPhase =
  | 'prepared'
  | 'checkpoint-ref-cleanup-pending'
  | 'external-cleanup-complete'
  | 'pi-file-cleanup-pending'
  | 'pi-file-cleanup-complete'

export interface SessionDeletionRecord {
  readonly phase: SessionDeletionPhase
  readonly resumed: boolean
  readonly piSessionFile: string | null
  readonly stagedPiSessionFile: string | null
  readonly checkpointRefs: readonly SessionDeletionCheckpointRef[]
}

export interface SessionDeletionCheckpointRef {
  readonly name: string
  readonly objectId: string
}

function checkpointRefs(raw: string | null): readonly SessionDeletionCheckpointRef[] {
  if (!raw) return []
  const parsed: unknown = JSON.parse(raw)
  if (!isMatching(P.array({ name: P.string, objectId: P.string }), parsed)) {
    throw new Error('Session deletion journal contains invalid checkpoint refs.')
  }
  return parsed
}

export async function prepareSessionDeletion(id: SessionId): Promise<SessionDeletionRecord> {
  return runStoreEffect(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      return yield* sql.withTransaction(
        Effect.gen(function* () {
          const existing = yield* sql<{
            readonly phase: SessionDeletionPhase
            readonly pi_session_file: string | null
            readonly staged_pi_session_file: string | null
            readonly checkpoint_refs_json: string | null
          }>`
            SELECT phase, pi_session_file, staged_pi_session_file, checkpoint_refs_json
            FROM session_deletion_operations WHERE session_id = ${id} LIMIT 1
          `
          if (existing[EMPTY_INDEX]) {
            const row = existing[EMPTY_INDEX]
            return {
              phase: row.phase,
              resumed: true,
              piSessionFile: row.pi_session_file,
              stagedPiSessionFile: row.staged_pi_session_file,
              checkpointRefs: checkpointRefs(row.checkpoint_refs_json),
            } as const
          }
          const now = Date.now()
          yield* sql`
            INSERT INTO session_deletion_operations (session_id, phase, created_at, updated_at)
            VALUES (${id}, ${'prepared'}, ${now}, ${now})
          `
          return {
            phase: 'prepared',
            resumed: false,
            piSessionFile: null,
            stagedPiSessionFile: null,
            checkpointRefs: [],
          } as const
        }),
      )
    }),
  )
}

export async function prepareSessionCheckpointRefCleanup(
  id: SessionId,
  refs: readonly SessionDeletionCheckpointRef[],
): Promise<void> {
  await runStoreEffect(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      yield* sql`
        UPDATE session_deletion_operations
        SET phase = ${'checkpoint-ref-cleanup-pending'},
            checkpoint_refs_json = ${JSON.stringify(refs)}, updated_at = ${Date.now()}
        WHERE session_id = ${id} AND phase = ${'prepared'}
      `
    }),
  )
}

export async function prepareSessionPiFileCleanup(
  id: SessionId,
  piSessionFile: string | null,
): Promise<SessionDeletionRecord> {
  return runStoreEffect(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const stagedPiSessionFile = piSessionFile ? `${piSessionFile}.${randomUUID()}.delete` : null
      yield* sql`
        UPDATE session_deletion_operations
        SET phase = ${'pi-file-cleanup-pending'}, pi_session_file = ${piSessionFile},
            staged_pi_session_file = ${stagedPiSessionFile}, updated_at = ${Date.now()}
        WHERE session_id = ${id} AND phase = ${'external-cleanup-complete'}
      `
      const rows = yield* sql<{
        readonly phase: SessionDeletionPhase
        readonly pi_session_file: string | null
        readonly staged_pi_session_file: string | null
        readonly checkpoint_refs_json: string | null
      }>`
        SELECT phase, pi_session_file, staged_pi_session_file, checkpoint_refs_json
        FROM session_deletion_operations WHERE session_id = ${id} LIMIT 1
      `
      const row = rows[EMPTY_INDEX]
      if (!row) throw new Error(`Session deletion journal disappeared for ${id}.`)
      return {
        phase: row.phase,
        resumed: true,
        piSessionFile: row.pi_session_file,
        stagedPiSessionFile: row.staged_pi_session_file,
        checkpointRefs: checkpointRefs(row.checkpoint_refs_json),
      }
    }),
  )
}

export async function markSessionPiFileCleanupComplete(id: SessionId): Promise<void> {
  await runStoreEffect(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      yield* sql`
        UPDATE session_deletion_operations
        SET phase = ${'pi-file-cleanup-complete'}, updated_at = ${Date.now()}
        WHERE session_id = ${id} AND phase = ${'pi-file-cleanup-pending'}
      `
    }),
  )
}

export async function markSessionDeletionExternalCleanupComplete(id: SessionId): Promise<void> {
  await runStoreEffect(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      yield* sql`
        UPDATE session_deletion_operations
        SET phase = ${'external-cleanup-complete'}, updated_at = ${Date.now()}
        WHERE session_id = ${id}
      `
    }),
  )
}

export async function abandonSessionDeletion(id: SessionId): Promise<void> {
  await runStoreEffect(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      yield* sql`DELETE FROM session_deletion_operations WHERE session_id = ${id}`
    }),
  )
}

export async function listPendingSessionDeletions(): Promise<SessionId[]> {
  return runStoreEffect(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const rows = yield* sql<{ readonly session_id: string }>`
        SELECT session_id FROM session_deletion_operations ORDER BY created_at, session_id
      `
      return rows.map((row) => SessionId(row.session_id))
    }),
  )
}

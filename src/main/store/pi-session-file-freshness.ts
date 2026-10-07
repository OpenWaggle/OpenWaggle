import { statSync } from 'node:fs'
import * as SqlClient from '@effect/sql/SqlClient'
import type { SessionId } from '@shared/types/brand'
import * as Effect from 'effect/Effect'
import { runStoreEffect } from './store-runtime'

/**
 * The Pi file state each Session's projection was read from (ADR 0048), kept with the projection.
 *
 * Every persisted snapshot advances the Session's revision and records the file's size and
 * modification time, so a later read tells in one `stat`, even after a Host restart, whether the
 * file changed outside OpenWaggle, and a projection read earlier can tell it was overtaken.
 */

export interface PiSessionFileState {
  readonly size: number
  readonly mtimeMs: number
}

export interface PiProjectionFreshness {
  readonly revision: number
  readonly fingerprint: PiSessionFileState | null
}

const INITIAL_REVISION = 0
const FIRST_RECORDED_REVISION = 1

export function statPiSessionFile(file: string | undefined): PiSessionFileState | null {
  if (!file) return null
  try {
    const stats = statSync(file)
    return { size: stats.size, mtimeMs: stats.mtimeMs }
  } catch {
    // Pi writes a session file only once it has something to keep.
    return null
  }
}

/** A snapshot was persisted from the file in the state `fingerprint` describes. */
export function recordPiProjectionWithSql(
  sql: SqlClient.SqlClient,
  sessionId: SessionId,
  fingerprint: PiSessionFileState | null,
  now: number,
) {
  return sql`
    INSERT INTO pi_session_file_projections (
      session_id, file_size, file_mtime_ms, revision, updated_at
    ) VALUES (
      ${sessionId}, ${fingerprint?.size ?? null}, ${fingerprint?.mtimeMs ?? null},
      ${FIRST_RECORDED_REVISION}, ${now}
    )
    ON CONFLICT (session_id) DO UPDATE SET
      file_size = excluded.file_size,
      file_mtime_ms = excluded.file_mtime_ms,
      revision = pi_session_file_projections.revision + 1,
      updated_at = excluded.updated_at
  `
}

export function readPiProjectionFreshnessWithSql(sql: SqlClient.SqlClient, sessionId: SessionId) {
  return Effect.map(
    sql<{
      readonly revision: number
      readonly file_size: number | null
      readonly file_mtime_ms: number | null
    }>`
      SELECT revision, file_size, file_mtime_ms FROM pi_session_file_projections
      WHERE session_id = ${sessionId} LIMIT 1
    `,
    (rows): PiProjectionFreshness => {
      const row = rows[0]
      if (!row) return { revision: INITIAL_REVISION, fingerprint: null }
      return {
        revision: row.revision,
        fingerprint:
          row.file_size === null || row.file_mtime_ms === null
            ? null
            : { size: row.file_size, mtimeMs: row.file_mtime_ms },
      }
    },
  )
}

/** The projection was checked against the file and still matches it; the revision is unchanged. */
export async function recordUnchangedPiProjection(
  sessionId: SessionId,
  expectedRevision: number,
  fingerprint: PiSessionFileState,
): Promise<boolean> {
  return runStoreEffect(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      return yield* sql.withTransaction(
        Effect.gen(function* () {
          const current = yield* readPiProjectionFreshnessWithSql(sql, sessionId)
          if (current.revision !== expectedRevision) return false
          const now = Date.now()
          yield* sql`
            INSERT INTO pi_session_file_projections (
              session_id, file_size, file_mtime_ms, revision, updated_at
            ) VALUES (
              ${sessionId}, ${fingerprint.size}, ${fingerprint.mtimeMs}, ${expectedRevision}, ${now}
            )
            ON CONFLICT (session_id) DO UPDATE SET
              file_size = excluded.file_size,
              file_mtime_ms = excluded.file_mtime_ms,
              updated_at = excluded.updated_at
          `
          return true
        }),
      )
    }),
  )
}

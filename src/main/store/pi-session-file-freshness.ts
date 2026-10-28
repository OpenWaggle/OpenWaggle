import { statSync } from 'node:fs'
import * as SqlClient from '@effect/sql/SqlClient'
import type { SessionId } from '@shared/types/brand'
import * as Effect from 'effect/Effect'
import { type PiSessionFileTail, readPiSessionFileTail } from './pi-session-file-tail'
import { discoveredPiEntryNodeIdPrefix } from './session-details/discovered-pi-entry-node-ids'
import { runStoreEffect } from './store-runtime'

/**
 * The Pi file state each Session's projection was read from (ADR 0051), kept with the projection.
 *
 * Every persisted snapshot advances the Session's revision and records the file's size and
 * modification time, so a later read tells in one `stat`, even after a Host restart, whether the
 * file changed outside OpenWaggle, and a projection read earlier can tell it was overtaken.
 */

export interface PiSessionFileState {
  readonly size: number
  readonly mtimeMs: number
  /** Where the file's last complete entry ends, when it ends in one (D6). */
  readonly tail?: PiSessionFileTail | null
}

/** The Pi entries a snapshot projected: how many, the node of the last one, and its leaf. */
export interface PiProjectedEntries {
  readonly entryCount: number
  readonly lastNodeId: string
  readonly leafNodeId: string | null
  /** The Pi adapter's entry-projection version, or null for nodes that came from elsewhere. */
  readonly projectionVersion: number | null
}

/**
 * The file's tail at the projection, recorded only when the projection's last entry is the file's
 * last line, so everything before `offset` is exactly what was projected.
 */
export interface PiProjectionTail extends PiSessionFileTail {
  readonly entryCount: number
  readonly leafNodeId: string | null
  /** Which entry-projection version stored the entries before the tail; null when unknown. */
  readonly projectionVersion: number | null
}

export interface PiProjectionFreshness {
  readonly revision: number
  readonly fingerprint: PiSessionFileState | null
  readonly tail: PiProjectionTail | null
}

const INITIAL_REVISION = 0
const FIRST_RECORDED_REVISION = 1

export function statPiSessionFile(file: string | undefined): PiSessionFileState | null {
  if (!file) return null
  try {
    const stats = statSync(file)
    // Read after the size: an entry appended in between is past the size, so it is read next time.
    const tail = readPiSessionFileTail(file)
    return {
      size: stats.size,
      mtimeMs: stats.mtimeMs,
      tail: tail && tail.offset <= stats.size ? tail : null,
    }
  } catch {
    // Pi writes a session file only once it has something to keep.
    return null
  }
}

function tailOfProjection(
  sessionId: SessionId,
  fingerprint: PiSessionFileState | null,
  projected: PiProjectedEntries | null,
) {
  const tail = fingerprint?.tail
  if (!tail || !projected) return null
  const lastEntryNodeIds = [
    tail.lastEntryId,
    `${discoveredPiEntryNodeIdPrefix(sessionId)}${tail.lastEntryId}`,
  ]
  return lastEntryNodeIds.includes(projected.lastNodeId) ? { ...tail, ...projected } : null
}

function tailColumns(tail: PiProjectionTail | null) {
  if (!tail) {
    return {
      offset: null,
      lineStart: null,
      digest: null,
      lastEntryId: null,
      entryCount: null,
      leafNodeId: null,
      projectionVersion: null,
    }
  }
  return tail
}

/**
 * A snapshot was persisted from the file in the state `fingerprint` describes. `projected` names
 * the Pi entries it holds; the file's tail is kept only when it ends at the last of them.
 */
export function recordPiProjectionWithSql(
  sql: SqlClient.SqlClient,
  sessionId: SessionId,
  fingerprint: PiSessionFileState | null,
  now: number,
  projected: PiProjectedEntries | null = null,
) {
  const tail = tailColumns(tailOfProjection(sessionId, fingerprint, projected))
  return sql`
    INSERT INTO pi_session_file_projections (
      session_id, file_size, file_mtime_ms, revision, updated_at, tail_offset, tail_line_start,
      tail_digest, tail_entry_id, tail_entry_count, tail_leaf_node_id, tail_projection_version
    ) VALUES (
      ${sessionId}, ${fingerprint?.size ?? null}, ${fingerprint?.mtimeMs ?? null},
      ${FIRST_RECORDED_REVISION}, ${now}, ${tail.offset}, ${tail.lineStart}, ${tail.digest},
      ${tail.lastEntryId}, ${tail.entryCount}, ${tail.leafNodeId}, ${tail.projectionVersion}
    )
    ON CONFLICT (session_id) DO UPDATE SET
      file_size = excluded.file_size,
      file_mtime_ms = excluded.file_mtime_ms,
      revision = pi_session_file_projections.revision + 1,
      updated_at = excluded.updated_at,
      tail_offset = excluded.tail_offset,
      tail_line_start = excluded.tail_line_start,
      tail_digest = excluded.tail_digest,
      tail_entry_id = excluded.tail_entry_id,
      tail_entry_count = excluded.tail_entry_count,
      tail_leaf_node_id = excluded.tail_leaf_node_id,
      tail_projection_version = excluded.tail_projection_version
  `
}

interface PiProjectionRow {
  readonly revision: number
  readonly file_size: number | null
  readonly file_mtime_ms: number | null
  readonly tail_offset: number | null
  readonly tail_line_start: number | null
  readonly tail_digest: string | null
  readonly tail_entry_id: string | null
  readonly tail_entry_count: number | null
  readonly tail_leaf_node_id: string | null
  readonly tail_projection_version: number | null
}

function projectionTailOf(row: PiProjectionRow): PiProjectionTail | null {
  if (
    row.tail_offset === null ||
    row.tail_line_start === null ||
    row.tail_digest === null ||
    row.tail_entry_id === null ||
    row.tail_entry_count === null
  ) {
    return null
  }
  return {
    offset: row.tail_offset,
    lineStart: row.tail_line_start,
    digest: row.tail_digest,
    lastEntryId: row.tail_entry_id,
    entryCount: row.tail_entry_count,
    leafNodeId: row.tail_leaf_node_id,
    projectionVersion: row.tail_projection_version,
  }
}

export function readPiProjectionFreshnessWithSql(sql: SqlClient.SqlClient, sessionId: SessionId) {
  return Effect.map(
    sql<PiProjectionRow>`
      SELECT revision, file_size, file_mtime_ms, tail_offset, tail_line_start, tail_digest,
        tail_entry_id, tail_entry_count, tail_leaf_node_id, tail_projection_version
      FROM pi_session_file_projections
      WHERE session_id = ${sessionId} LIMIT 1
    `,
    (rows): PiProjectionFreshness => {
      const row = rows[0]
      if (!row) return { revision: INITIAL_REVISION, fingerprint: null, tail: null }
      return {
        revision: row.revision,
        fingerprint:
          row.file_size === null || row.file_mtime_ms === null
            ? null
            : { size: row.file_size, mtimeMs: row.file_mtime_ms },
        tail: projectionTailOf(row),
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

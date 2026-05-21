import * as SqlClient from '@effect/sql/SqlClient'
import type { SessionBranchId, SessionId } from '@shared/types/brand'
import * as Effect from 'effect/Effect'
import { runStoreEffect } from '../store-runtime'
import { EMPTY_INDEX } from './constants'
import { mainBranchId } from './hydration'
import type { SessionBranchRow } from './types'

function selectMutableBranch(
  sql: SqlClient.SqlClient,
  sessionId: SessionId,
  branchId: SessionBranchId,
) {
  return Effect.gen(function* () {
    const rows = yield* sql<SessionBranchRow>`
      SELECT
        id,
        session_id,
        source_node_id,
        head_node_id,
        name,
        is_main,
        archived_at,
        created_at,
        updated_at
      FROM session_branches
      WHERE session_id = ${sessionId}
        AND id = ${branchId}
      LIMIT 1
    `
    const branch = rows[EMPTY_INDEX]
    if (!branch || branch.is_main === 1) {
      return yield* Effect.fail(new Error('Session branch not found or cannot be modified.'))
    }
    return branch
  })
}

export async function archiveSessionBranch(sessionId: SessionId, branchId: SessionBranchId) {
  await runStoreEffect(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      yield* selectMutableBranch(sql, sessionId, branchId)
      const now = Date.now()
      yield* sql`
        UPDATE session_branches
        SET archived_at = ${now},
            updated_at = ${now}
        WHERE session_id = ${sessionId}
          AND id = ${branchId}
          AND is_main = 0
          AND archived_at IS NULL
      `
      yield* sql`
        UPDATE sessions
        SET last_active_branch_id = ${mainBranchId(sessionId)},
            last_active_node_id = (
              SELECT head_node_id
              FROM session_branches
              WHERE session_id = ${sessionId}
                AND id = ${mainBranchId(sessionId)}
              LIMIT 1
            ),
            updated_at = ${now}
        WHERE id = ${sessionId}
          AND last_active_branch_id = ${branchId}
      `
    }),
  )
}

export async function restoreSessionBranch(sessionId: SessionId, branchId: SessionBranchId) {
  await runStoreEffect(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      yield* selectMutableBranch(sql, sessionId, branchId)
      const now = Date.now()
      yield* sql`
        UPDATE session_branches
        SET archived_at = ${null},
            updated_at = ${now}
        WHERE session_id = ${sessionId}
          AND id = ${branchId}
          AND is_main = 0
          AND archived_at IS NOT NULL
      `
    }),
  )
}

export async function renameSessionBranch(
  sessionId: SessionId,
  branchId: SessionBranchId,
  name: string,
) {
  const normalizedName = name.trim()
  if (!normalizedName) throw new Error('Branch name must be non-empty.')

  await runStoreEffect(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      yield* selectMutableBranch(sql, sessionId, branchId)
      const now = Date.now()
      yield* sql`
        UPDATE session_branches
        SET name = ${normalizedName},
            updated_at = ${now}
        WHERE session_id = ${sessionId}
          AND id = ${branchId}
          AND is_main = 0
      `
    }),
  )
}

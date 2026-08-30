import * as SqlClient from '@effect/sql/SqlClient'
import type { SessionId } from '@shared/types/brand'
import * as Effect from 'effect/Effect'
import type { SessionNodeRow } from '../session-details'
import { runStoreEffect } from '../store-runtime'
import { buildSessionNodes } from './hydration'

export async function listSessionResourceProjectionPage(
  sessionId: SessionId,
  afterCreatedOrder: number,
  limit: number,
) {
  return runStoreEffect(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const rows = yield* sql<SessionNodeRow>`
        SELECT
          id,
          session_id,
          parent_id,
          pi_entry_type,
          kind,
          role,
          timestamp_ms,
          content_json,
          metadata_json,
          branch_hint_id,
          path_depth,
          created_order
        FROM session_nodes
        WHERE session_id = ${sessionId}
          AND created_order > ${afterCreatedOrder}
        ORDER BY created_order ASC
        LIMIT ${limit + 1}
      `
      const pageRows = rows.slice(0, limit)
      return {
        nodes: buildSessionNodes(pageRows),
        throughCreatedOrder: pageRows.at(-1)?.created_order ?? null,
        hasMore: rows.length > limit,
      }
    }),
  )
}

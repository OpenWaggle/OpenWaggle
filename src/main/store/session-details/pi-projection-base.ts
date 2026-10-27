import * as SqlClient from '@effect/sql/SqlClient'
import type { SessionId } from '@shared/types/brand'
import * as Effect from 'effect/Effect'
import type { ProjectedSessionNodeInput } from '../../ports/session-repository'
import {
  type PiProjectionTail,
  readPiProjectionFreshnessWithSql,
} from '../pi-session-file-freshness'
import { runStoreEffect } from '../store-runtime'
import type { SessionNodeRow } from './types'

/**
 * What a Pi projection needs to keep the entries of a Session's current projection instead of
 * projecting them again (D6): the projection's revision and recorded tail, and the kind and role
 * each node was stored with, which only projecting an entry in full would tell.
 */
export interface PiProjectionBase {
  readonly revision: number
  readonly tail: PiProjectionTail
  readonly storedShapeByNodeId: ReadonlyMap<
    string,
    Pick<ProjectedSessionNodeInput, 'kind' | 'role'>
  >
}

/** Null when the Session's projection recorded no tail, so its next one reads every entry. */
export async function readPiProjectionBase(sessionId: SessionId): Promise<PiProjectionBase | null> {
  return runStoreEffect(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      return yield* sql.withTransaction(
        Effect.gen(function* () {
          const { revision, tail } = yield* readPiProjectionFreshnessWithSql(sql, sessionId)
          if (!tail) return null
          const rows = yield* sql<Pick<SessionNodeRow, 'id' | 'kind' | 'role'>>`
            SELECT id, kind, role FROM session_nodes WHERE session_id = ${sessionId}
          `
          return {
            revision,
            tail,
            storedShapeByNodeId: new Map(
              rows.map((row) => [row.id, { kind: row.kind, role: row.role }] as const),
            ),
          }
        }),
      )
    }),
  )
}

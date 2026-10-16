import * as SqlClient from '@effect/sql/SqlClient'
import { SessionId } from '@shared/types/brand'
import * as Effect from 'effect/Effect'
import type { TitleOwedDiscoveredSession } from '../../ports/pi-session-discovery'
import { runStoreEffect } from '../store-runtime'

/** See `PiSessionDiscoveryRepositoryShape.listTitleOwedDiscoveredSessions`. */
export async function listTitleOwedDiscoveredPiSessions(input: {
  readonly activeAfter: number
  readonly limit: number
}): Promise<readonly TitleOwedDiscoveredSession[]> {
  return runStoreEffect(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const rows = yield* sql<{
        readonly session_id: string
        readonly pi_session_file: string
        readonly title_source: string
      }>`
        SELECT sessions.id AS session_id, sessions.pi_session_file, sessions.title_source
        FROM sessions
        JOIN pi_session_adoptions ON pi_session_adoptions.session_id = sessions.id
        WHERE sessions.pi_session_file IS NOT NULL AND sessions.archived = ${0}
          AND (
            sessions.title_source = ${'default'}
            OR (sessions.title_source = ${'provisional'} AND sessions.updated_at >= ${input.activeAfter})
          )
        ORDER BY sessions.updated_at DESC
        LIMIT ${input.limit}
      `
      return rows.map((row) => ({
        sessionId: SessionId(row.session_id),
        piSessionFile: row.pi_session_file,
        titleSource: row.title_source === 'provisional' ? 'provisional' : 'default',
      }))
    }),
  )
}

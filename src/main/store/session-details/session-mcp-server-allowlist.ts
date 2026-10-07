import * as SqlClient from '@effect/sql/SqlClient'
import { parseJsonUnknown } from '@shared/schema'
import { isRecord } from '@shared/utils/validation'
import * as Effect from 'effect/Effect'
import { runStoreEffect } from '../store-runtime'

/**
 * The MCP servers a Session's Agent definition narrows it to (`mcpServers` in its execution
 * profile), or undefined when it may use every configured server. A profile that cannot be read
 * allows nothing, so a broken profile never widens access.
 */
export async function readSessionMcpServerAllowlist(
  sessionId: string,
): Promise<readonly string[] | undefined> {
  return runStoreEffect(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const rows = yield* sql<{ readonly profile_json: string }>`
        SELECT profile_json FROM session_execution_profiles WHERE session_id = ${sessionId} LIMIT 1
      `
      const row = rows[0]
      if (!row) return undefined
      let parsed: unknown
      try {
        parsed = parseJsonUnknown(row.profile_json)
      } catch {
        return []
      }
      if (!isRecord(parsed)) return []
      const servers = parsed.mcpServers
      if (servers === undefined) return undefined
      return Array.isArray(servers)
        ? servers.filter((name): name is string => typeof name === 'string')
        : []
    }),
  )
}

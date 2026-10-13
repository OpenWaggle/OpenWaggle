import * as SqlClient from '@effect/sql/SqlClient'
import { parseJsonUnknown } from '@shared/schema'
import { isRecord } from '@shared/utils/validation'
import * as Effect from 'effect/Effect'
import { runStoreEffect } from '../store-runtime'

/**
 * A list from a Session's execution profile (its Agent definition's `tools` or `mcpServers`), or
 * undefined when the profile does not restrict it. A profile that cannot be read allows nothing,
 * so a broken profile never widens access.
 */
async function readProfileList(
  sessionId: string,
  key: 'tools' | 'mcpServers',
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
      const list = parsed[key]
      if (list === undefined) return undefined
      return Array.isArray(list)
        ? list.filter((name): name is string => typeof name === 'string')
        : []
    }),
  )
}

/** The MCP servers a Session's Agent definition narrows it to, or undefined for every server. */
export function readSessionMcpServerAllowlist(sessionId: string) {
  return readProfileList(sessionId, 'mcpServers')
}

/** The tools a Session's Agent definition allows, `mcp__…` patterns included, or undefined. */
export function readSessionToolAllowlist(sessionId: string) {
  return readProfileList(sessionId, 'tools')
}

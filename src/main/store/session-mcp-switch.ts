/**
 * Session-level MCP off (ADR 0048). It is Session state in the Host database, not configuration:
 * it changes no MCP file, survives a Host restart, and a Session is on unless switched off.
 * Deleting a Session drops its row by foreign key cascade; archiving keeps it, so an unarchived
 * Session still has MCP off.
 */
import * as SqlClient from '@effect/sql/SqlClient'
import * as Effect from 'effect/Effect'
import { runStoreEffect } from './store-runtime'

export async function isSessionMcpEnabled(sessionId: string): Promise<boolean> {
  return runStoreEffect(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const rows = yield* sql<{ readonly session_id: string }>`
        SELECT session_id FROM session_mcp_disabled WHERE session_id = ${sessionId}
      `
      return rows.length === 0
    }),
  )
}

/** Switches MCP off for a Session the Host has; an unknown Session is ignored. */
export async function disableSessionMcp(sessionId: string): Promise<void> {
  await runStoreEffect(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      yield* sql`
        INSERT INTO session_mcp_disabled (session_id, disabled_at)
        SELECT id, ${Date.now()} FROM sessions WHERE id = ${sessionId}
        ON CONFLICT (session_id) DO NOTHING
      `
    }),
  )
}

async function forgetSessionMcpSwitch(sessionId: string): Promise<void> {
  await runStoreEffect(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      yield* sql`DELETE FROM session_mcp_disabled WHERE session_id = ${sessionId}`
    }),
  )
}

export function setSessionMcpEnabled(sessionId: string, enabled: boolean): Promise<void> {
  return enabled ? forgetSessionMcpSwitch(sessionId) : disableSessionMcp(sessionId)
}

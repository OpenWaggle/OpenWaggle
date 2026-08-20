import * as SqlClient from '@effect/sql/SqlClient'
import type { AgentAuthorizationMode } from '@shared/types/agent-authorization'
import type { SessionId } from '@shared/types/brand'
import type { SessionEnvironmentMode } from '@shared/types/git'
import * as Effect from 'effect/Effect'
import { runStoreEffect } from '../store-runtime'
import { EMPTY_INDEX } from './constants'
import { stageSessionFileDeletion } from './file-deletion'
import type { UpdateSessionRuntimeInput } from './types'

export interface SessionWorktreeRefRow {
  readonly sessionId: string
  readonly worktreePath: string | null
}

/** Persist a session's environment mode and Session worktree path (birth). */
export async function setSessionWorktree(
  id: SessionId,
  environmentMode: SessionEnvironmentMode,
  worktreePath: string | null,
): Promise<void> {
  await runStoreEffect(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      yield* sql`
        UPDATE sessions
        SET environment_mode = ${environmentMode},
            worktree_path = ${worktreePath},
            updated_at = ${Date.now()}
        WHERE id = ${id}
      `
    }),
  )
}

/** Persist the per-session env mode + Worktree base ref plan (before birth). */
export async function setSessionWorktreePlan(
  id: SessionId,
  environmentMode: SessionEnvironmentMode,
  baseRef: string | null,
  startFromOrigin: boolean,
): Promise<void> {
  await runStoreEffect(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      yield* sql`
        UPDATE sessions
        SET environment_mode = ${environmentMode},
            worktree_base_ref = ${baseRef},
            worktree_start_from_origin = ${startFromOrigin ? 1 : 0},
            updated_at = ${Date.now()}
        WHERE id = ${id}
      `
    }),
  )
}

export async function setSessionAuthorizationMode(
  id: SessionId,
  authorizationMode: AgentAuthorizationMode,
): Promise<void> {
  await runStoreEffect(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      yield* sql`
        UPDATE sessions
        SET authorization_mode = ${authorizationMode},
            updated_at = ${Date.now()}
        WHERE id = ${id}
      `
    }),
  )
}

/** Clear a session's Session worktree binding (death). */
export async function clearSessionWorktree(id: SessionId): Promise<void> {
  await runStoreEffect(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      yield* sql`UPDATE sessions SET worktree_path = NULL, updated_at = ${Date.now()} WHERE id = ${id}`
    }),
  )
}

/** All sessions' worktree paths, for orphan detection before removal. */
export async function listSessionWorktreeRefs(): Promise<SessionWorktreeRefRow[]> {
  return runStoreEffect(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const rows = yield* sql<{ readonly id: string; readonly worktree_path: string | null }>`
        SELECT id, worktree_path FROM sessions WHERE worktree_path IS NOT NULL
      `
      return rows.map((row) => ({ sessionId: row.id, worktreePath: row.worktree_path }))
    }),
  )
}

export async function updateSessionRuntime(input: UpdateSessionRuntimeInput): Promise<void> {
  await runStoreEffect(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      yield* sql`
        UPDATE sessions
        SET pi_session_id = COALESCE(${input.piSessionId ?? null}, pi_session_id),
            pi_session_file = COALESCE(${input.piSessionFile ?? null}, pi_session_file),
            updated_at = ${Date.now()}
        WHERE id = ${input.sessionId}
      `
    }),
  )
}

export async function deleteSession(id: SessionId): Promise<void> {
  const piSessionFile = await runStoreEffect(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const rows = yield* sql<{ readonly pi_session_file: string | null }>`
        SELECT pi_session_file FROM sessions WHERE id = ${id} LIMIT 1
      `
      return rows[EMPTY_INDEX]?.pi_session_file ?? null
    }),
  )
  const stagedFile = await stageSessionFileDeletion(piSessionFile)

  try {
    await runStoreEffect(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* sql`DELETE FROM sessions WHERE id = ${id}`
      }),
    )
    await stagedFile.cleanup()
  } catch (error) {
    await stagedFile.restore()
    throw error
  }
}

async function updateArchivedState(id: SessionId, archived: boolean) {
  await runStoreEffect(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      yield* sql`
        UPDATE sessions
        SET archived = ${archived ? 1 : 0}, updated_at = ${Date.now()}
        WHERE id = ${id}
      `
    }),
  )
}

export async function archiveSession(id: SessionId): Promise<void> {
  await updateArchivedState(id, true)
}

export async function unarchiveSession(id: SessionId): Promise<void> {
  await updateArchivedState(id, false)
}

export async function updateSessionTitle(id: SessionId, title: string): Promise<void> {
  await runStoreEffect(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      yield* sql`
        UPDATE sessions
        SET title = ${title}, updated_at = ${Date.now()}
        WHERE id = ${id}
      `
    }),
  )
}

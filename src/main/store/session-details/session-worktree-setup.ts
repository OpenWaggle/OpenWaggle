import { randomUUID } from 'node:crypto'
import * as SqlClient from '@effect/sql/SqlClient'
import type { SessionId } from '@shared/types/brand'
import * as Effect from 'effect/Effect'
import { runStoreEffect } from '../store-runtime'
import { EMPTY_INDEX } from './constants'
import {
  type ClaimedSessionWorktreeSetup,
  hydrateSetupDispatch,
  type PendingSessionWorktreeSetup,
  type SessionWorktreeSetupDispatch,
  type SessionWorktreeSetupRow,
} from './session-worktree-setup-record'

export type {
  AcceptedSessionWorktreeSetup,
  ClaimedSessionWorktreeSetup,
  PendingSessionWorktreeSetup,
  SessionWorktreeSetupDispatch,
} from './session-worktree-setup-record'

interface SessionWorktreeBindingRow {
  readonly worktree_path: string | null
}

function replacePendingSetup(
  sql: SqlClient.SqlClient,
  id: SessionId,
  worktreePath: string,
  generation: string,
) {
  const now = Date.now()
  return sql`
    INSERT INTO session_worktree_setup (
      session_id, worktree_path, generation, dispatch_state, claim_token, accepted_at,
      created_at, updated_at
    )
    VALUES (${id}, ${worktreePath}, ${generation}, 'pending', NULL, NULL, ${now}, ${now})
    ON CONFLICT(session_id) DO UPDATE SET
      worktree_path = excluded.worktree_path,
      generation = excluded.generation,
      dispatch_state = excluded.dispatch_state,
      claim_token = excluded.claim_token,
      accepted_at = excluded.accepted_at,
      created_at = excluded.created_at,
      updated_at = excluded.updated_at
  `
}

/** Start a new setup-dispatch generation, including before Git mutates the filesystem. */
export async function resetSessionWorktreeSetup(
  id: SessionId,
  worktreePath: string,
): Promise<PendingSessionWorktreeSetup> {
  const generation = randomUUID()
  await runStoreEffect(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      yield* replacePendingSetup(sql, id, worktreePath, generation)
    }),
  )
  return { worktreePath, generation, state: 'pending' }
}

/**
 * Reset setup only when `worktreePath` is the session's recorded missing tree.
 *
 * The renderer supplies both values during manual recreation. The conditional insert keeps an
 * arbitrary session id from marking another path for automatic command execution.
 */
export async function resetRecordedSessionWorktreeSetup(
  id: SessionId,
  worktreePath: string,
): Promise<PendingSessionWorktreeSetup | null> {
  const generation = randomUUID()
  return runStoreEffect(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      return yield* sql.withTransaction(
        Effect.gen(function* () {
          const sessions = yield* sql<{ readonly id: string }>`
            SELECT id
            FROM sessions
            WHERE id = ${id}
              AND environment_mode = 'worktree'
              AND worktree_path = ${worktreePath}
            LIMIT 1
          `
          if (!sessions[EMPTY_INDEX]) return null
          yield* replacePendingSetup(sql, id, worktreePath, generation)
          return {
            worktreePath,
            generation,
            state: 'pending',
          } satisfies PendingSessionWorktreeSetup
        }),
      )
    }),
  )
}

/**
 * Record an unbound but verified worktree and recover its pending Setup generation.
 *
 * A stale in-memory Session may still have a null path after a previous birth completed. The
 * persisted binding distinguishes that harmless stale copy from a crash between Git creation and
 * recording the path, so an already completed generation never runs twice.
 */
export async function adoptSessionWorktreeForSetup(
  id: SessionId,
  worktreePath: string,
): Promise<PendingSessionWorktreeSetup | null> {
  return runStoreEffect(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      return yield* sql.withTransaction(
        Effect.gen(function* () {
          const sessionRows = yield* sql<SessionWorktreeBindingRow>`
            SELECT worktree_path
            FROM sessions
            WHERE id = ${id}
            LIMIT 1
          `
          const binding = sessionRows[EMPTY_INDEX]
          if (!binding) throw new Error(`Session ${id} does not exist.`)

          const rows = yield* sql<SessionWorktreeSetupRow>`
            SELECT worktree_path, generation, dispatch_state, claim_token, accepted_at
            FROM session_worktree_setup
            WHERE session_id = ${id}
            LIMIT 1
          `
          const dispatch = hydrateSetupDispatch(rows[EMPTY_INDEX])
          if (binding.worktree_path === worktreePath) {
            return dispatch?.worktreePath === worktreePath && dispatch.state === 'pending'
              ? dispatch
              : null
          }
          if (binding.worktree_path !== null) {
            throw new Error('The Session worktree binding changed during recovery.')
          }

          const next =
            dispatch?.worktreePath === worktreePath
              ? dispatch
              : { worktreePath, generation: randomUUID(), state: 'pending' as const }
          if (dispatch?.worktreePath !== worktreePath) {
            yield* replacePendingSetup(sql, id, worktreePath, next.generation)
          }
          yield* sql`
            UPDATE sessions
            SET environment_mode = 'worktree',
                worktree_path = ${worktreePath},
                updated_at = ${Date.now()}
            WHERE id = ${id}
          `
          return next.state === 'pending' ? next : null
        }),
      )
    }),
  )
}

export async function getPendingSessionWorktreeSetup(
  id: SessionId,
): Promise<PendingSessionWorktreeSetup | null> {
  const dispatch = await getSessionWorktreeSetupDispatch(id)
  return dispatch?.state === 'pending' ? dispatch : null
}

export async function getSessionWorktreeSetupDispatch(
  id: SessionId,
): Promise<SessionWorktreeSetupDispatch | null> {
  return runStoreEffect(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const rows = yield* sql<SessionWorktreeSetupRow>`
        SELECT worktree_path, generation, dispatch_state, claim_token, accepted_at
        FROM session_worktree_setup
        WHERE session_id = ${id}
        LIMIT 1
      `
      return hydrateSetupDispatch(rows[EMPTY_INDEX])
    }),
  )
}

/**
 * Durably reserve one generation before any terminal handoff.
 *
 * SQLite and a PTY cannot participate in one transaction. A surviving claim therefore means the
 * previous app process may or may not have handed the command to the shell, and recovery must not
 * replay it. This chooses at-most-once side effects over automatic replay of an arbitrary command.
 */
export async function claimSessionWorktreeSetup(
  id: SessionId,
  pending: PendingSessionWorktreeSetup,
): Promise<ClaimedSessionWorktreeSetup | null> {
  const claimToken = randomUUID()
  const updatedAt = Date.now()
  return runStoreEffect(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      return yield* sql.withTransaction(
        Effect.gen(function* () {
          yield* sql`
            UPDATE session_worktree_setup
            SET dispatch_state = 'claimed',
                claim_token = ${claimToken},
                accepted_at = NULL,
                updated_at = ${updatedAt}
            WHERE session_id = ${id}
              AND worktree_path = ${pending.worktreePath}
              AND generation = ${pending.generation}
              AND dispatch_state = 'pending'
          `
          const rows = yield* sql<SessionWorktreeSetupRow>`
            SELECT worktree_path, generation, dispatch_state, claim_token, accepted_at
            FROM session_worktree_setup
            WHERE session_id = ${id}
              AND generation = ${pending.generation}
              AND claim_token = ${claimToken}
            LIMIT 1
          `
          const dispatch = hydrateSetupDispatch(rows[EMPTY_INDEX])
          return dispatch?.state === 'claimed' ? dispatch : null
        }),
      )
    }),
  )
}

/** Restore retryability only for an in-process failure before semantic terminal acceptance. */
export async function releaseSessionWorktreeSetupClaim(
  id: SessionId,
  claim: ClaimedSessionWorktreeSetup,
): Promise<void> {
  await runStoreEffect(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      yield* sql`
        UPDATE session_worktree_setup
        SET dispatch_state = 'pending',
            claim_token = NULL,
            accepted_at = NULL,
            updated_at = ${Date.now()}
        WHERE session_id = ${id}
          AND worktree_path = ${claim.worktreePath}
          AND generation = ${claim.generation}
          AND dispatch_state = 'claimed'
          AND claim_token = ${claim.claimToken}
      `
    }),
  )
}

/** Keep a durable receipt for the claimed generation whose semantic command main accepted. */
export async function completeSessionWorktreeSetup(
  id: SessionId,
  claim: ClaimedSessionWorktreeSetup,
): Promise<void> {
  const acceptedAt = Date.now()
  await runStoreEffect(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      yield* sql`
        UPDATE session_worktree_setup
        SET dispatch_state = 'accepted',
            accepted_at = ${acceptedAt},
            updated_at = ${acceptedAt}
        WHERE session_id = ${id}
          AND worktree_path = ${claim.worktreePath}
          AND generation = ${claim.generation}
          AND dispatch_state = 'claimed'
          AND claim_token = ${claim.claimToken}
      `
    }),
  )
}

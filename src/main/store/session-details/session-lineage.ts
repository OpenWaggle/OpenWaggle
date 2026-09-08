import * as SqlClient from '@effect/sql/SqlClient'
import type { SessionId } from '@shared/types/brand'
import type { EstablishSessionLineageInput, SessionDelegationState } from '@shared/types/session'
import * as Effect from 'effect/Effect'
import { runStoreEffect } from '../store-runtime'
import { EMPTY_INDEX } from './constants'

export async function hasDirectSessionWorkers(sessionId: SessionId): Promise<boolean> {
  return runStoreEffect(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const rows = yield* sql<{ readonly present: number }>`
        SELECT 1 AS present
        FROM session_lineage
        WHERE parent_session_id = ${sessionId}
        LIMIT 1
      `
      return rows[EMPTY_INDEX]?.present === 1
    }),
  )
}

export async function hasActiveSessionWorker(sessionId: SessionId): Promise<boolean> {
  return runStoreEffect(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const rows = yield* sql<{ readonly present: number }>`
        SELECT 1 AS present
        FROM session_lineage
        WHERE session_id = ${sessionId}
          AND delegation_state IN ('working', 'waiting')
        LIMIT 1
      `
      return rows[EMPTY_INDEX]?.present === 1
    }),
  )
}

/** Establishes immutable parentage once; retries cannot silently reparent an existing worker. */
export async function establishSessionLineage(input: EstablishSessionLineageInput): Promise<void> {
  const now = Date.now()
  await runStoreEffect(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      yield* sql`
        INSERT INTO session_lineage (
          session_id,
          parent_session_id,
          agent_definition_name,
          delegation_state,
          created_at,
          updated_at
        ) VALUES (
          ${input.sessionId},
          ${input.parentSessionId},
          ${input.agentDefinitionName},
          ${input.delegationState},
          ${now},
          ${now}
        )
        ON CONFLICT(session_id) DO NOTHING
      `
    }),
  )
}

/** Updates only established workers; ordinary sessions remain independent. */
export async function setSessionDelegationState(
  sessionId: SessionId,
  delegationState: SessionDelegationState,
): Promise<void> {
  await runStoreEffect(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const updated = yield* sql<{ readonly session_id: string }>`
        UPDATE session_lineage
        SET delegation_state = ${delegationState}, updated_at = ${Date.now()}
        WHERE session_id = ${sessionId}
        RETURNING session_id
      `
      if (!updated[EMPTY_INDEX]) {
        return yield* Effect.fail(
          new Error('Cannot update delegation state before Session lineage is established.'),
        )
      }
    }),
  )
}

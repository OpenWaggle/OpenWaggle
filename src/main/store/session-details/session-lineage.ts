import * as SqlClient from '@effect/sql/SqlClient'
import type { SessionId } from '@shared/types/brand'
import type { EstablishSessionLineageInput, SessionDelegationState } from '@shared/types/session'
import * as Effect from 'effect/Effect'
import { runStoreEffect } from '../store-runtime'

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
      yield* sql`
        UPDATE session_lineage
        SET delegation_state = ${delegationState}, updated_at = ${Date.now()}
        WHERE session_id = ${sessionId}
      `
    }),
  )
}

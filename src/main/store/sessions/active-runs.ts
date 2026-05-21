import * as SqlClient from '@effect/sql/SqlClient'
import * as Effect from 'effect/Effect'
import type {
  PersistSessionActiveRunInput,
  RecoverableSessionActiveRun,
  SessionActiveRunIdentity,
  SessionInterruptedRunScope,
} from '../../ports/session-repository'
import { runStoreEffect } from '../store-runtime'
import { hydrateRecoverableActiveRun } from './hydration'
import type { SessionActiveRunRow } from './types'

export async function recordSessionActiveRun(input: PersistSessionActiveRunInput) {
  const now = Date.now()
  await runStoreEffect(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      yield* sql`
        INSERT INTO session_active_runs (
          run_id,
          session_id,
          branch_id,
          run_mode,
          status,
          runtime_json,
          updated_at
        )
        VALUES (
          ${input.runId},
          ${input.sessionId},
          ${input.branchId},
          ${input.runMode},
          ${'running'},
          ${JSON.stringify({ model: String(input.model) })},
          ${now}
        )
        ON CONFLICT(run_id) DO UPDATE SET
          session_id = excluded.session_id,
          branch_id = excluded.branch_id,
          run_mode = excluded.run_mode,
          status = excluded.status,
          runtime_json = excluded.runtime_json,
          updated_at = excluded.updated_at
      `
    }),
  )
}

export async function clearSessionActiveRun(input: SessionActiveRunIdentity) {
  await runStoreEffect(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      yield* sql`
        DELETE FROM session_active_runs
        WHERE session_id = ${input.sessionId}
          AND run_id = ${input.runId}
      `
    }),
  )
}

export async function clearInterruptedSessionRuns(input: SessionInterruptedRunScope) {
  await runStoreEffect(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      yield* sql`
        DELETE FROM session_active_runs
        WHERE session_id = ${input.sessionId}
          AND branch_id = ${input.branchId}
          AND status = ${'interrupted'}
      `
    }),
  )
}

export async function listSessionActiveRunsForRecovery(): Promise<RecoverableSessionActiveRun[]> {
  return runStoreEffect(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const rows = yield* sql<SessionActiveRunRow>`
        SELECT
          run_id,
          session_id,
          branch_id,
          run_mode,
          status,
          runtime_json,
          updated_at
        FROM session_active_runs
        WHERE status = ${'running'}
        ORDER BY updated_at ASC
      `

      return rows.flatMap((row) => {
        const activeRun = hydrateRecoverableActiveRun(row)
        return activeRun ? [activeRun] : []
      })
    }),
  )
}

export async function markSessionActiveRunInterrupted(input: SessionActiveRunIdentity) {
  await runStoreEffect(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      yield* sql`
        UPDATE session_active_runs
        SET status = ${'interrupted'},
            updated_at = ${Date.now()}
        WHERE session_id = ${input.sessionId}
          AND run_id = ${input.runId}
      `
    }),
  )
}

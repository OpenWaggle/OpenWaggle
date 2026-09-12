import * as SqlClient from '@effect/sql/SqlClient'
import { Effect } from 'effect'
import {
  type MigrationIdentity,
  planSessionHostLedgerUpgrade,
  SESSION_HOST_ALPHA_BASELINE_ID,
  SESSION_HOST_LEDGER_PAGE_SIZE,
} from './session-host-ledger-compatibility'

/** Runs only during owner-side database initialization, never in the read-only cutover preflight. */
export const repairSessionHostMigrationLedger = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  yield* sql.withTransaction(
    Effect.gen(function* () {
      const rows =
        yield* sql<MigrationIdentity>`SELECT id, name FROM _migrations WHERE id >= ${SESSION_HOST_ALPHA_BASELINE_ID} ORDER BY id LIMIT ${SESSION_HOST_LEDGER_PAGE_SIZE}`
      const plan = yield* Effect.try(() => planSessionHostLedgerUpgrade(rows))
      for (const row of plan) {
        yield* sql`UPDATE _migrations SET id = ${row.targetId} WHERE id = ${row.id} AND name = ${row.name}`
      }
    }),
  )
})

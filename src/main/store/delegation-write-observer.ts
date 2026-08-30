import * as SqlClient from '@effect/sql/SqlClient'
import type { SessionId } from '@shared/types/brand'
import * as Effect from 'effect/Effect'
import { observeDelegationTurnWrites } from '../adapters/sqlite-session-delegation-write-observer'
import { runStoreEffect } from './store-runtime'

export function recordDelegationTurnWrites(input: {
  readonly workerSessionId: SessionId
  readonly runId: string
  readonly paths: readonly string[]
}) {
  return runStoreEffect(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      return yield* observeDelegationTurnWrites(sql, {
        ...input,
        now: Date.now(),
      })
    }),
  )
}

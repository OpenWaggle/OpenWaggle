import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type * as SqlClient from '@effect/sql/SqlClient'
import * as Effect from 'effect/Effect'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DesktopNotificationFacts } from '../../ports/desktop-notification-facts'
import {
  insertSession,
  withMigrationDatabase,
} from '../../services/__tests__/database-migrations.test-harness'
import { runMigrations } from '../../services/database-migration-runner'
import { SqliteDesktopNotificationFactsLive } from '../sqlite-desktop-notification-facts'

let tmpRoot = ''

function insertRun(
  sql: SqlClient.SqlClient,
  input: { id: string; sessionId: string; status: string; intent: object; updatedAt: number },
) {
  return sql`
    INSERT INTO session_runs (id, session_id, status, intent_json, created_at, updated_at)
    VALUES (${input.id}, ${input.sessionId}, ${input.status}, ${JSON.stringify(input.intent)},
      ${1}, ${input.updatedAt})
  `
}

function withFacts<A>(
  seed: (sql: SqlClient.SqlClient) => Effect.Effect<unknown, unknown>,
  use: (facts: typeof DesktopNotificationFacts.Service) => Effect.Effect<A, unknown>,
) {
  return withMigrationDatabase(tmpRoot, (sql) =>
    Effect.gen(function* () {
      yield* runMigrations()
      yield* seed(sql)
      const facts = yield* Effect.provide(
        DesktopNotificationFacts,
        SqliteDesktopNotificationFactsLive,
      )
      return yield* use(facts)
    }),
  )
}

describe('SqliteDesktopNotificationFactsLive', () => {
  beforeEach(async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'desktop-notification-facts-'))
  })
  afterEach(async () => {
    await fs.rm(tmpRoot, { recursive: true, force: true })
  })

  it('reads every fact against the real schema', async () => {
    const result = await withFacts(
      () => Effect.void,
      (facts) =>
        Effect.all({
          session: facts.session('missing'),
          run: facts.run('missing', 'run'),
          visit: facts.lastVisitedAt('missing'),
          stuck: facts.stuckWorkerIds(),
          lost: facts.runsInterruptedByHostLossSince(0),
        }),
    )
    expect(result).toEqual({ session: null, run: null, visit: null, stuck: [], lost: [] })
  })

  it("reads a root Session, its Run's caller, the visit receipt and Runs lost with the Host", async () => {
    const result = await withFacts(
      (sql) =>
        Effect.gen(function* () {
          yield* insertSession(sql, 'root')
          yield* insertRun(sql, {
            id: 'run-person',
            sessionId: 'root',
            status: 'completed',
            intent: { callerId: 'gui:local-user', idempotencyKey: 'a' },
            updatedAt: 5,
          })
          yield* insertRun(sql, {
            id: 'run-agent',
            sessionId: 'root',
            status: 'interrupted-by-host-loss',
            intent: { callerId: 'session-agent:queen:run-1', idempotencyKey: 'b' },
            updatedAt: 20,
          })
          yield* sql`INSERT INTO session_visit_receipts (session_id, last_visited_at, updated_at)
            VALUES ('root', 42, 42)`
        }),
      (facts) =>
        Effect.all({
          session: facts.session('root'),
          person: facts.run('root', 'run-person'),
          agent: facts.run('root', 'run-agent'),
          visit: facts.lastVisitedAt('root'),
          lost: facts.runsInterruptedByHostLossSince(10),
        }),
    )
    expect(result).toEqual({
      session: expect.objectContaining({
        sessionId: 'root',
        title: 'Older session',
        archived: false,
        parentSessionId: null,
      }),
      person: { originCallerId: 'gui:local-user', scheduledTaskPolicy: null },
      agent: { originCallerId: 'session-agent:queen:run-1', scheduledTaskPolicy: null },
      visit: 42,
      lost: [{ sessionId: 'root', runId: 'run-agent' }],
    })
  })
})

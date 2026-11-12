import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import * as SqlClient from '@effect/sql/SqlClient'
import * as Effect from 'effect/Effect'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  executeSessionQuery as executeQuery,
  makeSessionQueryRuntime as makeRuntime,
} from './sqlite-session-query-test-layer'

describe('SQLite Session catalog Done below (ADR 0065)', () => {
  let temporaryRoot = ''
  const runtimes: ReturnType<typeof makeRuntime>[] = []

  beforeEach(async () => {
    temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-done-below-'))
  })

  afterEach(async () => {
    await Promise.all(runtimes.splice(0).map((runtime) => runtime.dispose()))
    await fs.rm(temporaryRoot, { recursive: true, force: true })
  })

  it('lists a parent as Done below until it is visited, never while a Worker runs', async () => {
    const runtime = makeRuntime(path.join(temporaryRoot, 'done-below.sqlite'))
    runtimes.push(runtime)
    const run = (statement: (sql: SqlClient.SqlClient) => Effect.Effect<unknown, unknown>) =>
      runtime.runPromise(
        Effect.gen(function* () {
          yield* statement(yield* SqlClient.SqlClient)
        }),
      )
    const completedIds = async () => {
      const result = await executeQuery(runtime, {
        operation: 'list',
        archived: false,
        unreadTerminalStatus: 'completed',
        limit: 10,
      })
      if (result.outcome.operation !== 'list' || !('sessions' in result.outcome)) {
        throw new Error('Expected a terminal Session list.')
      }
      return result.outcome.sessions.map((session) => session.sessionId)
    }
    // The Queen delegated and her Run ended at 1; the person opened her at 2; her Worker ended at 3.
    await run(
      (sql) => sql`UPDATE session_runs SET status = ${'completed'} WHERE id = ${'run-queen'}`,
    )
    await run(
      (sql) => sql`
        INSERT INTO session_visit_receipts (session_id, last_visited_at, updated_at)
        VALUES (${'queen'}, ${2}, ${2}), (${'worker'}, ${9}, ${9})
      `,
    )
    expect(await completedIds()).toEqual(['queen'])

    // Visiting the Queen clears it.
    await run(
      (sql) =>
        sql`UPDATE session_visit_receipts SET last_visited_at = ${5} WHERE session_id = ${'queen'}`,
    )
    expect(await completedIds()).toEqual([])

    // Her own unread Run does not read Done while a Worker below her runs.
    await run(
      (sql) => sql`
        INSERT INTO session_runs (id, session_id, status, created_at, updated_at)
        VALUES (${'run-queen-2'}, ${'queen'}, ${'completed'}, ${6}, ${6}),
          (${'run-worker-3'}, ${'worker'}, ${'active'}, ${7}, ${7})
      `,
    )
    expect(await completedIds()).toEqual([])

    // Her row reads Interrupted, which outranks Done below, once her own last Run was stopped.
    await run(
      (sql) => sql`
        UPDATE session_runs SET status = ${'completed'}, updated_at = ${8} WHERE id = ${'run-worker-3'}
      `,
    )
    expect(await completedIds()).toEqual(['queen'])
    await run(
      (sql) => sql`UPDATE session_runs SET status = ${'interrupted'} WHERE id = ${'run-queen-2'}`,
    )
    expect(await completedIds()).toEqual([])
  })
})

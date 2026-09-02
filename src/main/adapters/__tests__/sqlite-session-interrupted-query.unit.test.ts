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

const INTERRUPTED_RUN_STATUSES = [
  'interrupted',
  'interrupted-by-host-loss',
  'interrupted-by-interaction-timeout',
] as const

describe('SQLite interrupted Session catalog query', () => {
  let temporaryRoot = ''
  const runtimes: Array<ReturnType<typeof makeRuntime>> = []

  beforeEach(async () => {
    temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-interrupted-query-'))
  })

  afterEach(async () => {
    await Promise.all(runtimes.splice(0).map((runtime) => runtime.dispose()))
    await fs.rm(temporaryRoot, { recursive: true, force: true })
  })

  it('pages and counts latest interrupted Host Runs beyond the first catalog page using both Run indexes', async () => {
    const runtime = makeRuntime(path.join(temporaryRoot, 'interrupted.sqlite'))
    runtimes.push(runtime)
    const interruptedSessionIds = Array.from(
      { length: 150 },
      (_, index) => `interrupted-${String(index).padStart(3, '0')}`,
    )

    await runtime.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* Effect.forEach(interruptedSessionIds, (sessionId, index) =>
          Effect.gen(function* () {
            yield* sql`
              INSERT INTO sessions (
                id, pi_session_id, project_path, title, archived, created_at, updated_at
              ) VALUES (
                ${sessionId}, ${`pi-${sessionId}`}, ${'/project-interrupted'},
                ${`Interrupted ${String(index)}`}, ${0}, ${index}, ${index + 100}
              )
            `
            yield* sql`
              INSERT INTO session_runs (id, session_id, status, created_at, updated_at)
              VALUES (
                ${`run-${sessionId}`}, ${sessionId},
                ${INTERRUPTED_RUN_STATUSES[index % INTERRUPTED_RUN_STATUSES.length]},
                ${index}, ${index + 100}
              )
            `
          }),
        )
      }),
    )

    const first = await executeQuery(runtime, {
      operation: 'list',
      archived: false,
      interrupted: true,
      limit: 100,
    })
    if (first.outcome.operation !== 'list' || !('sessions' in first.outcome)) {
      throw new Error('Expected an interrupted Session catalog page.')
    }
    expect(first.outcome.sessions).toHaveLength(100)
    expect(first.outcome.totalCount).toBe(150)
    const nextCursor = first.outcome.nextCursor
    if (!nextCursor) throw new Error('Expected another interrupted Session catalog page.')

    const second = await executeQuery(runtime, {
      operation: 'list',
      archived: false,
      interrupted: true,
      limit: 100,
      cursor: nextCursor,
    })
    expect(second.outcome).toMatchObject({ operation: 'list' })
    if (second.outcome.operation !== 'list' || !('sessions' in second.outcome)) {
      throw new Error('Expected a second interrupted Session catalog page.')
    }
    expect(second.outcome.sessions).toHaveLength(50)

    const plan = await runtime.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        return yield* sql<{ readonly detail: string }>`
          EXPLAIN QUERY PLAN
          SELECT sessions.id, COUNT(*) OVER () AS total_count
          FROM sessions
          WHERE sessions.archived = ${0}
            AND sessions.id IN (
              SELECT session_id
              FROM session_runs AS interrupted_runs
              WHERE interrupted_runs.status IN ${sql.in(INTERRUPTED_RUN_STATUSES)}
                AND NOT EXISTS (
                  SELECT 1
                  FROM session_runs AS newer_runs
                  WHERE newer_runs.session_id = interrupted_runs.session_id
                    AND (
                      newer_runs.updated_at > interrupted_runs.updated_at
                      OR (
                        newer_runs.updated_at = interrupted_runs.updated_at
                        AND newer_runs.id > interrupted_runs.id
                      )
                    )
                )
            )
          ORDER BY sessions.updated_at DESC, sessions.id DESC
          LIMIT ${101}
        `
      }),
    )
    const details = plan.map((row) => row.detail).join('\n')
    expect(details).toContain('idx_session_runs_status_session_updated')
    expect(details).toContain('idx_session_runs_session_updated')
    expect(details).not.toContain('SCAN sessions')
  })

  it('excludes a Session when a later canonical Run supersedes an interruption', async () => {
    const runtime = makeRuntime(path.join(temporaryRoot, 'latest-run.sqlite'))
    runtimes.push(runtime)

    const interrupted = await executeQuery(runtime, {
      operation: 'list',
      archived: false,
      interrupted: true,
      limit: 10,
    })
    const uninterrupted = await executeQuery(runtime, {
      operation: 'list',
      archived: false,
      interrupted: false,
      limit: 10,
    })

    if (interrupted.outcome.operation !== 'list' || !('sessions' in interrupted.outcome)) {
      throw new Error('Expected an interrupted Session catalog page.')
    }
    if (uninterrupted.outcome.operation !== 'list' || !('sessions' in uninterrupted.outcome)) {
      throw new Error('Expected an uninterrupted Session catalog page.')
    }
    expect(interrupted.outcome.sessions).toEqual([])
    expect(interrupted.outcome.totalCount).toBe(0)
    expect(uninterrupted.outcome.sessions.map((session) => session.sessionId)).toEqual([
      'queen',
      'worker',
      'other',
    ])
  })
})

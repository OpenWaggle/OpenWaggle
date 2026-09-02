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

describe('SQLite Session catalog search', () => {
  let temporaryRoot = ''
  const runtimes: Array<ReturnType<typeof makeRuntime>> = []

  beforeEach(async () => {
    temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-session-query-'))
  })

  afterEach(async () => {
    await Promise.all(runtimes.splice(0).map((runtime) => runtime.dispose()))
    await fs.rm(temporaryRoot, { recursive: true, force: true })
  })

  it('finds Sessions by an indexed project path outside the loaded catalog page', async () => {
    const runtime = makeRuntime(path.join(temporaryRoot, 'project-search.sqlite'))
    runtimes.push(runtime)
    const result = await executeQuery(runtime, {
      operation: 'search',
      query: 'project-b',
      mode: 'lexical',
      limit: 10,
    })
    expect(result.outcome).toMatchObject({
      operation: 'search',
      sessions: [
        {
          sessionId: 'other',
          discoveryEvidence: { matchedFields: ['project'] },
        },
      ],
    })
  })

  it('filters the catalog by visible title substrings', async () => {
    const runtime = makeRuntime(path.join(temporaryRoot, 'catalog-substring.sqlite'))
    runtimes.push(runtime)
    const result = await executeQuery(runtime, {
      operation: 'list',
      searchText: 'chite',
      archived: false,
      limit: 10,
    })
    const shortQuery = await executeQuery(runtime, {
      operation: 'list',
      searchText: 'iv',
      archived: false,
      limit: 10,
    })

    expect(result.outcome).toMatchObject({
      operation: 'list',
      sessions: [{ sessionId: 'queen', title: 'Architecture hive' }],
    })
    expect(shortQuery.outcome).toMatchObject({
      operation: 'list',
      sessions: [
        { sessionId: 'queen', title: 'Architecture hive' },
        { sessionId: 'other', title: 'Private other' },
      ],
    })
  })

  it('uses covering cursor indexes for global and project catalogs', async () => {
    const runtime = makeRuntime(path.join(temporaryRoot, 'catalog-plan.sqlite'))
    runtimes.push(runtime)
    const plans = await runtime.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        const global = yield* sql<{ readonly detail: string }>`
          EXPLAIN QUERY PLAN
          SELECT id FROM sessions
          WHERE archived = ${0}
          ORDER BY updated_at DESC, id DESC LIMIT ${201}
        `
        const project = yield* sql<{ readonly detail: string }>`
          EXPLAIN QUERY PLAN
          SELECT id FROM sessions
          WHERE project_path = ${'/project-a'} AND archived = ${0}
          ORDER BY updated_at DESC, id DESC LIMIT ${201}
        `
        return { global, project }
      }),
    )

    expect(plans.global.map((row) => row.detail).join('\n')).toContain(
      'idx_sessions_catalog_cursor',
    )
    expect(plans.project.map((row) => row.detail).join('\n')).toContain(
      'idx_sessions_project_catalog_cursor',
    )
  })

  it('paginates exact unread terminal counts across the complete catalog', async () => {
    const runtime = makeRuntime(path.join(temporaryRoot, 'terminal-filter.sqlite'))
    runtimes.push(runtime)
    await runtime.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* sql.unsafe(`
          WITH RECURSIVE sequence(value) AS (
            SELECT 0 UNION ALL SELECT value + 1 FROM sequence WHERE value < 250
          )
          INSERT INTO sessions (
            id, pi_session_id, project_path, title, archived, created_at, updated_at
          )
          SELECT printf('failed-%03d', value), printf('pi-failed-%03d', value),
            '/project-terminal', printf('Failed %03d', value), 0, 1, 1000 + value
          FROM sequence
        `)
        yield* sql.unsafe(`
          WITH RECURSIVE sequence(value) AS (
            SELECT 0 UNION ALL SELECT value + 1 FROM sequence WHERE value < 250
          )
          INSERT INTO session_runs (id, session_id, status, created_at, updated_at)
          SELECT printf('run-failed-%03d', value), printf('failed-%03d', value),
            'failed', 1, 1000 + value
          FROM sequence
        `)
        yield* sql`
          INSERT INTO session_visit_receipts (session_id, last_visited_at, updated_at)
          VALUES (${'failed-000'}, ${1_000}, ${1_000})
        `
      }),
    )

    const first = await executeQuery(runtime, {
      operation: 'list',
      archived: false,
      unreadTerminalStatus: 'failed',
      limit: 200,
    })
    if (first.outcome.operation !== 'list' || !('sessions' in first.outcome)) {
      throw new Error('Expected a terminal Session list.')
    }
    expect(first.outcome.sessions).toHaveLength(200)
    expect(first.outcome.totalCount).toBe(250)
    expect(first.outcome.nextCursor).toBeDefined()

    const second = await executeQuery(runtime, {
      operation: 'list',
      archived: false,
      unreadTerminalStatus: 'failed',
      limit: 200,
      cursor: first.outcome.nextCursor,
    })
    if (second.outcome.operation !== 'list' || !('sessions' in second.outcome)) {
      throw new Error('Expected a terminal Session list page.')
    }
    expect(second.outcome.sessions).toHaveLength(50)
    expect(second.outcome.totalCount).toBeUndefined()
    expect(
      [...first.outcome.sessions, ...second.outcome.sessions].some(
        (session) => session.sessionId === 'failed-000',
      ),
    ).toBe(false)
  })

  it('requires the latest terminal Run to be newer than its visit receipt', async () => {
    const runtime = makeRuntime(path.join(temporaryRoot, 'terminal-receipt.sqlite'))
    runtimes.push(runtime)
    const unread = await executeQuery(runtime, {
      operation: 'list',
      archived: false,
      unreadTerminalStatus: 'completed',
      limit: 10,
    })
    expect(unread.outcome).toMatchObject({
      operation: 'list',
      totalCount: 1,
      sessions: [{ sessionId: 'worker' }],
    })

    await runtime.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* sql`
          INSERT INTO session_visit_receipts (session_id, last_visited_at, updated_at)
          VALUES (${'worker'}, ${3}, ${3})
        `
        yield* sql`
          INSERT INTO session_runs (id, session_id, status, created_at, updated_at)
          VALUES (${'run-worker-failed'}, ${'worker'}, ${'failed'}, ${4}, ${4})
        `
      }),
    )
    const seenCompletion = await executeQuery(runtime, {
      operation: 'list',
      archived: false,
      unreadTerminalStatus: 'completed',
      limit: 10,
    })
    const unreadFailure = await executeQuery(runtime, {
      operation: 'list',
      archived: false,
      unreadTerminalStatus: 'failed',
      limit: 10,
    })
    expect(seenCompletion.outcome).toMatchObject({
      operation: 'list',
      totalCount: 0,
      sessions: [],
    })
    expect(unreadFailure.outcome).toMatchObject({
      operation: 'list',
      totalCount: 1,
      sessions: [{ sessionId: 'worker' }],
    })
  })

  it('uses run, receipt, and project indexes for sidebar filters', async () => {
    const runtime = makeRuntime(path.join(temporaryRoot, 'sidebar-filter-plan.sqlite'))
    runtimes.push(runtime)
    const plans = await runtime.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        const terminal = yield* sql<{ readonly detail: string }>`
          EXPLAIN QUERY PLAN
          SELECT terminal_runs.session_id
          FROM session_runs AS terminal_runs
          LEFT JOIN session_visit_receipts AS visit_receipts
            ON visit_receipts.session_id = terminal_runs.session_id
          WHERE terminal_runs.status = ${'failed'}
            AND terminal_runs.updated_at > COALESCE(visit_receipts.last_visited_at, -1)
            AND NOT EXISTS (
              SELECT 1 FROM session_runs AS newer_runs
              WHERE newer_runs.session_id = terminal_runs.session_id
                AND (newer_runs.updated_at > terminal_runs.updated_at
                  OR (newer_runs.updated_at = terminal_runs.updated_at
                    AND newer_runs.id > terminal_runs.id))
            )
        `
        const projects = yield* sql<{ readonly detail: string }>`
          EXPLAIN QUERY PLAN
          SELECT id FROM sessions INDEXED BY idx_sessions_project_catalog_cursor
          WHERE project_path IN ${sql.in(['/project-a', '/project-b'])}
            AND archived = ${0}
          ORDER BY updated_at DESC, id DESC LIMIT ${200}
        `
        return { terminal, projects }
      }),
    )
    const terminalPlan = plans.terminal.map((row) => row.detail).join('\n')
    expect(terminalPlan).toContain('idx_session_runs_status_session_updated')
    expect(terminalPlan).toContain('idx_session_runs_session_updated')
    expect(terminalPlan).toContain('session_visit_receipts')
    expect(plans.projects.map((row) => row.detail).join('\n')).toContain(
      'idx_sessions_project_catalog_cursor',
    )
  })
})

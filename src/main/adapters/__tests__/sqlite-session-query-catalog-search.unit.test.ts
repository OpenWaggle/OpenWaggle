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
})

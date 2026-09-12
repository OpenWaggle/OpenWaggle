import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import * as SqlClient from '@effect/sql/SqlClient'
import * as Statement from '@effect/sql/Statement'
import type { LocalSessionProfileAuthority } from '@shared/types/local-session-profile'
import { SESSION_QUERY_CONTRACT_VERSION } from '@shared/types/session-query'
import * as Effect from 'effect/Effect'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { refreshSessionTranscriptTerms } from '../../services/session-transcript-term-projection'
import type { DiscoverySearchRequest } from '../sqlite-session-discovery-window'
import { loadLexicalDiscoveryRows } from '../sqlite-session-lexical-search'
import { makeSessionQueryRuntime } from './sqlite-session-query-test-layer'

interface QueryPlanStep {
  readonly id: number
  readonly parent: number
  readonly detail: string
}

function readTranscript(
  sql: SqlClient.SqlClient,
  query: Partial<DiscoverySearchRequest['query']> = {},
  authority?: LocalSessionProfileAuthority,
) {
  return loadLexicalDiscoveryRows(sql, authority, {
    contractVersion: SESSION_QUERY_CONTRACT_VERSION,
    requestId: 'common-visibility',
    query: {
      operation: 'search',
      query: 'neural',
      searchScope: 'full-transcript',
      mode: 'lexical',
      limit: 10,
      ...query,
    },
  })
}

describe('SQLite common-term search plans', () => {
  let temporaryRoot = ''
  let runtime: ReturnType<typeof makeSessionQueryRuntime>

  beforeEach(async () => {
    temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-common-plan-'))
    runtime = makeSessionQueryRuntime(path.join(temporaryRoot, 'search.sqlite'))
  })

  afterEach(async () => {
    await runtime.dispose()
    await fs.rm(temporaryRoot, { recursive: true, force: true })
  })

  it('filters archived Sessions without a Session row lookup for each transcript posting', async () => {
    const result = await runtime.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        let queryStatement: Statement.Statement<unknown> | undefined
        const rows = yield* Statement.withTransformer(
          loadLexicalDiscoveryRows(sql, undefined, {
            contractVersion: SESSION_QUERY_CONTRACT_VERSION,
            requestId: 'common-query-plan',
            query: {
              operation: 'search',
              query: 'neural',
              searchScope: 'full-transcript',
              mode: 'lexical',
              limit: 10,
            },
          }),
          (statement) => {
            queryStatement = statement
            return Effect.succeed(statement)
          },
        )
        if (!queryStatement) throw new Error('Transcript search did not execute a query.')
        const [query, parameters] = queryStatement.compile()
        const plan = yield* sql.unsafe<QueryPlanStep>(`EXPLAIN QUERY PLAN ${query}`, parameters)
        return { rows, plan }
      }),
    )

    expect(result.rows.map((row) => row.session_id)).toEqual(['worker'])
    const ranking = result.plan.find(
      (step) => step.detail === 'MATERIALIZE matching_non_phrase_session_ids',
    )
    expect(ranking).toBeDefined()
    const rankingSteps = result.plan.filter((step) => step.parent === ranking?.id)
    expect(rankingSteps.map((step) => step.detail)).toContain(
      'SEARCH seed_terms USING PRIMARY KEY (term=?)',
    )
    expect(rankingSteps.some((step) => /^SEARCH sessions /u.test(step.detail))).toBe(false)
  })

  it('excludes archived hits before the window and preserves inclusion, scope, and live updates', async () => {
    const result = await runtime.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* sql.unsafe(`
          WITH RECURSIVE sequence(value) AS (
            SELECT 0 UNION ALL SELECT value + 1 FROM sequence WHERE value < 511
          )
          INSERT INTO sessions (
            id, pi_session_id, project_path, title, archived, created_at, updated_at
          )
          SELECT printf('archived-%03d', value), printf('pi-archived-%03d', value),
            '/project-b', 'Archived match', 1, value, value FROM sequence
        `)
        yield* sql.unsafe(`
          INSERT INTO session_nodes (
            id, session_id, kind, role, timestamp_ms, content_json, metadata_json, created_order
          )
          SELECT id || '-node', id, 'message', 'user', 1, '{"text":"neural"}', '{}', 0
          FROM sessions WHERE id LIKE 'archived-%'
        `)
        yield* refreshSessionTranscriptTerms(
          sql,
          Array.from({ length: 512 }, (_, index) => `archived-${String(index).padStart(3, '0')}`),
        )
        const visible = yield* readTranscript(sql)
        const included = yield* readTranscript(sql, { includeArchived: true })
        const authorized = yield* readTranscript(
          sql,
          { includeArchived: true },
          {
            profileId: 'worker-only',
            profileName: 'Worker only',
            capabilities: ['sessions:discover'],
            scope: { sessionIds: ['worker'] },
            authorizationCeiling: 'ask-for-approval',
          },
        )
        const project = yield* readTranscript(sql, { projectPath: '/project-b' })
        const workingPath = yield* readTranscript(sql, { workingPath: '/project-b' })
        yield* sql`UPDATE sessions SET archived = 1 WHERE id = ${'worker'}`
        const afterArchive = yield* readTranscript(sql)
        yield* sql`UPDATE sessions SET archived = 0 WHERE id = ${'worker'}`
        const afterRestore = yield* readTranscript(sql)
        return { visible, included, authorized, project, workingPath, afterArchive, afterRestore }
      }),
    )

    expect(result.visible.map((row) => row.session_id)).toEqual(['worker'])
    expect(result.included).toHaveLength(501)
    expect(result.included[0]?.session_id).toBe('archived-000')
    expect(result.authorized.map((row) => row.session_id)).toEqual(['worker'])
    expect(result.project).toEqual([])
    expect(result.workingPath).toEqual([])
    expect(result.afterArchive).toEqual([])
    expect(result.afterRestore.map((row) => row.session_id)).toEqual(['worker'])
  })
})

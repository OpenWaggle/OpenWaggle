import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import * as SqlClient from '@effect/sql/SqlClient'
import * as Statement from '@effect/sql/Statement'
import type { LocalSessionProfileAuthority } from '@shared/types/local-session-profile'
import { SESSION_QUERY_CONTRACT_VERSION } from '@shared/types/session-query'
import * as Effect from 'effect/Effect'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { DiscoverySearchRequest } from '../sqlite-session-discovery-window'
import { lexicalFtsQuery, loadLexicalDiscoveryRows } from '../sqlite-session-lexical-search'
import { makeSessionQueryRuntime } from './sqlite-session-query-test-layer'

interface RankedSession {
  readonly session_id: string
  readonly score: number
}

interface RankingCase {
  readonly query: Partial<DiscoverySearchRequest['query']>
  readonly allowedIds: readonly string[] | undefined
  readonly profile: LocalSessionProfileAuthority | undefined
}

function request(query: Partial<DiscoverySearchRequest['query']> = {}): DiscoverySearchRequest {
  return {
    contractVersion: SESSION_QUERY_CONTRACT_VERSION,
    requestId: 'discovery-ranking',
    query: { operation: 'search', query: 'marker', mode: 'lexical', limit: 10, ...query },
  }
}

function authority(scope: LocalSessionProfileAuthority['scope']): LocalSessionProfileAuthority {
  return {
    profileId: 'ranking-profile',
    profileName: 'Ranking profile',
    capabilities: ['sessions:discover'],
    scope,
    authorizationCeiling: 'ask-for-approval',
  }
}

function seedRankedSessions(sql: SqlClient.SqlClient) {
  return Effect.gen(function* () {
    yield* sql.unsafe(`
      WITH RECURSIVE sequence(value) AS (
        SELECT 0 UNION ALL SELECT value + 1 FROM sequence WHERE value < 1099
      )
      INSERT INTO sessions (
        id, pi_session_id, project_path, title, archived, created_at, updated_at
      )
      SELECT printf('rank-%04d', value), printf('pi-rank-%04d', value),
        CASE WHEN value < 1024 THEN '/private' ELSE '/visible' END,
        printf('Title %04d', value), CASE WHEN value < 512 THEN 1 ELSE 0 END,
        value, value FROM sequence
    `)
    yield* sql.unsafe(`
      INSERT INTO session_nodes (
        id, session_id, kind, role, timestamp_ms, content_json, metadata_json, created_order
      )
      SELECT id || '-node', id, 'message', 'user', 1,
        json_object('text', CASE WHEN id < 'rank-1024' THEN 'marker'
          WHEN id = 'rank-1099' THEN 'marker ballast'
          ELSE 'marker ballast with additional text' END), '{}', 0
      FROM sessions WHERE id LIKE 'rank-%'
    `)
    yield* sql.unsafe(`
      INSERT INTO workspace_resources (
        id, project_path, kind, working_path, lifecycle_state, created_at, updated_at
      ) VALUES ('rank-visible-workspace', '/visible', 'local', '/visible', 'ready', 1, 1)
    `)
    yield* sql.unsafe(`
      INSERT INTO session_workspace_bindings (session_id, workspace_id, bound_at)
      SELECT id, 'rank-visible-workspace', 1 FROM sessions WHERE project_path = '/visible'
    `)
    yield* sql`
      INSERT INTO sessions (id, pi_session_id, title, created_at, updated_at)
      VALUES (${'split-fields'}, ${'pi-split-fields'}, ${'Split fields'}, 1, 1)
    `
    yield* sql`
      INSERT INTO session_nodes (
        id, session_id, kind, role, timestamp_ms, content_json, metadata_json, created_order
      ) VALUES
        (${'split-initial'}, ${'split-fields'}, ${'message'}, ${'user'}, 1,
          ${'{"text":"marker"}'}, ${'{}'}, 0),
        (${'split-preview'}, ${'split-fields'}, ${'message'}, ${'assistant'}, 2,
          ${'{"text":"ballast"}'}, ${'{}'}, 1)
    `
  })
}

describe('SQLite discovery ranking metadata', () => {
  let temporaryRoot = ''
  let runtime: ReturnType<typeof makeSessionQueryRuntime>

  beforeEach(async () => {
    temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-discovery-ranking-'))
    runtime = makeSessionQueryRuntime(path.join(temporaryRoot, 'search.sqlite'))
  })

  afterEach(async () => {
    await runtime.dispose()
    await fs.rm(temporaryRoot, { recursive: true, force: true })
  })

  it('reads ranking metadata by integer key instead of FTS content callbacks', async () => {
    const result = await runtime.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        let queryStatement: Statement.Statement<unknown> | undefined
        const rows = yield* Statement.withTransformer(
          loadLexicalDiscoveryRows(sql, undefined, request({ query: 'page' })),
          (statement) => {
            queryStatement = statement
            return Effect.succeed(statement)
          },
        )
        if (!queryStatement) throw new Error('Discovery search did not execute a query.')
        const [query, parameters] = queryStatement.compile()
        const plan = yield* sql.unsafe<{ readonly detail: string }>(
          `EXPLAIN QUERY PLAN ${query}`,
          parameters,
        )
        return { rows, plan: plan.map((step) => step.detail) }
      }),
    )

    expect(result.rows.map((row) => row.session_id)).toEqual(['worker'])
    expect(result.plan).toContain('SEARCH discovery_metadata USING INTEGER PRIMARY KEY (rowid=?)')
  })

  it('preserves public FTS scores, Session-ID ties, and eligibility before the window', async () => {
    await runtime.runPromise(Effect.flatMap(SqlClient.SqlClient, seedRankedSessions))
    const visibleIds = Array.from({ length: 76 }, (_, index) => `rank-${1024 + index}`)
    const cases: readonly RankingCase[] = [
      { query: {}, allowedIds: undefined, profile: undefined },
      { query: { includeArchived: true }, allowedIds: undefined, profile: undefined },
      { query: { projectPath: '/visible' }, allowedIds: visibleIds, profile: undefined },
      { query: { workingPath: '/visible' }, allowedIds: visibleIds, profile: undefined },
      { query: {}, allowedIds: visibleIds, profile: authority({ projectPaths: ['/visible'] }) },
      { query: {}, allowedIds: ['rank-1099'], profile: authority({ sessionIds: ['rank-1099'] }) },
      { query: {}, allowedIds: [], profile: authority({}) },
      {
        query: { projectPath: '/private' },
        allowedIds: [],
        profile: authority({ projectPaths: ['/visible'] }),
      },
      { query: { query: 'marker ballast' }, allowedIds: undefined, profile: undefined },
      { query: { query: '"marker ballast"' }, allowedIds: undefined, profile: undefined },
    ]
    for (const entry of cases) {
      const input = request(entry.query)
      const result = await runtime.runPromise(
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const rows = yield* loadLexicalDiscoveryRows(sql, entry.profile, input)
          const ftsQuery = lexicalFtsQuery(input.query.query)
          const reference = yield* sql<RankedSession>`
            SELECT session_id, bm25(session_node_discovery_search, 0.0, 0.0, 3.0, 3.0) AS score
            FROM session_node_discovery_search
            WHERE (${input.query.includeArchived ? 1 : 0} = 1 OR archived = 0)
              AND session_node_discovery_search MATCH
                ${`initial_objective : (${ftsQuery}) OR current_preview : (${ftsQuery})`}
            ORDER BY score, session_id
          `
          return { rows, reference }
        }),
      )
      const allowedIds = entry.allowedIds ? new Set(entry.allowedIds) : undefined
      const expected = result.reference
        .filter((row) => !allowedIds || allowedIds.has(row.session_id))
        .slice(0, 501)
      expect(result.rows.map(({ session_id, score }) => ({ session_id, score }))).toEqual(expected)
      if (entry.allowedIds === visibleIds) expect(result.rows[0]?.session_id).toBe('rank-1099')
      if (input.query.query.includes('ballast')) {
        expect(result.rows.some((row) => row.session_id === 'split-fields')).toBe(false)
      }
    }
  })

  it('binds c0/c1 to live Session and archive values across content, archive, and delete changes', async () => {
    await runtime.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* sql`
          INSERT INTO sessions (id, pi_session_id, title, created_at, updated_at)
          VALUES (${'metadata-target'}, ${'pi-metadata-target'}, ${'Metadata target'}, 1, 1)
        `
        yield* sql`
          INSERT INTO session_nodes (
            id, session_id, kind, role, timestamp_ms, content_json, metadata_json, created_order
          ) VALUES (
            ${'metadata-node'}, ${'metadata-target'}, ${'message'}, ${'user'}, 1,
            ${'{"text":"initial content"}'}, ${'{}'}, 0
          )
        `
        yield* sql`UPDATE session_nodes SET content_json = ${'{"text":"marker revised"}'}
          WHERE id = ${'metadata-node'}`
        const visible = yield* loadLexicalDiscoveryRows(sql, undefined, request())
        expect(visible.map((row) => row.session_id)).toEqual(['metadata-target'])
        yield* sql`UPDATE sessions SET archived = 1 WHERE id = ${'metadata-target'}`
        const mismatch = yield* sql<{ readonly mismatch: number }>`
          SELECT COUNT(*) AS mismatch FROM session_node_discovery_search AS search
          JOIN session_node_discovery_search_content AS content ON content.id = search.rowid
          WHERE search.session_id IS NOT content.c0 OR search.archived IS NOT content.c1
        `
        expect(mismatch).toEqual([{ mismatch: 0 }])
        expect(yield* loadLexicalDiscoveryRows(sql, undefined, request())).toEqual([])
        const archived = yield* loadLexicalDiscoveryRows(
          sql,
          undefined,
          request({ includeArchived: true }),
        )
        expect(archived.map((row) => row.session_id)).toEqual(['metadata-target'])
        yield* sql`UPDATE sessions SET archived = 0 WHERE id = ${'metadata-target'}`
        const restored = yield* loadLexicalDiscoveryRows(sql, undefined, request())
        expect(restored).toEqual(visible)
        yield* sql`DELETE FROM sessions WHERE id = ${'metadata-target'}`
        expect(yield* loadLexicalDiscoveryRows(sql, undefined, request())).toEqual([])
      }),
    )
  })
})

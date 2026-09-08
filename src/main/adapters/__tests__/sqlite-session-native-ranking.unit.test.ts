import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import * as SqlClient from '@effect/sql/SqlClient'
import * as Statement from '@effect/sql/Statement'
import * as Effect from 'effect/Effect'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { loadLexicalDiscoveryRows } from '../sqlite-session-lexical-search'
import {
  compareNativeRanking,
  nativeRankingRequest,
  seedNativeRankingSessions,
} from './native-ranking.test-utils'
import {
  captureNativeRanking,
  legacyDiscoveryRanking,
  nativeScoreCalls,
} from './native-ranking-instrumentation.test-utils'
import { makeSessionQueryRuntime } from './sqlite-session-query-test-layer'

describe('Native discovery ranking', () => {
  let temporaryRoot = ''
  let runtime: ReturnType<typeof makeSessionQueryRuntime>

  beforeEach(async () => {
    temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-native-ranking-'))
    runtime = makeSessionQueryRuntime(path.join(temporaryRoot, 'search.sqlite'))
  })

  afterEach(async () => {
    await runtime.dispose()
    await fs.rm(temporaryRoot, { recursive: true, force: true })
  })

  it('uses indexed signature members while preserving native BM25 scores and Session-ID ties', async () => {
    const result = await runtime.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* seedNativeRankingSessions(sql)
        let executed: Statement.Statement<unknown> | undefined
        const rows = yield* Statement.withTransformer(
          loadLexicalDiscoveryRows(sql, undefined, nativeRankingRequest()),
          (statement) => {
            executed = statement
            return Effect.succeed(statement)
          },
        )
        if (!executed) throw new Error('Discovery did not execute its ranking statement.')
        const [query, parameters] = executed.compile()
        const plan = yield* sql.unsafe<{ readonly detail: string }>(
          `EXPLAIN QUERY PLAN ${query}`,
          parameters,
        )
        const reference = yield* sql<{ readonly session_id: string; readonly score: number }>`
          SELECT session_id, bm25(session_node_discovery_search, 0.0, 0.0, 3.0, 3.0) AS score
          FROM session_node_discovery_search
          WHERE archived = 0 AND session_node_discovery_search MATCH
            ${'initial_objective : ("markernative") OR current_preview : ("markernative")'}
          ORDER BY score, session_id LIMIT 501
        `
        return { rows, reference, plan: plan.map((step) => step.detail) }
      }),
    )
    expect(result.rows.map(({ session_id, score }) => ({ session_id, score }))).toEqual(
      result.reference,
    )
    expect(result.rows).toHaveLength(501)
    expect(result.plan.some((step) => step.includes('idx_session_discovery_term_members'))).toBe(
      true,
    )
  })

  it('scores one representative for a dense signature without opening the fallback scoring path', async () => {
    const captured = await runtime.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* seedNativeRankingSessions(sql)
        return yield* captureNativeRanking(sql, nativeRankingRequest())
      }),
    )
    expect(nativeScoreCalls(path.join(temporaryRoot, 'search.sqlite'), captured)).toEqual({
      groups: 1,
      fallback: 0,
    })
  })

  it.each([64, 65, 1200])(
    'retains complete native fallback results when %i signatures do not reduce candidate work',
    async (signatureCount) => {
      const captured = await runtime.runPromise(
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          yield* seedNativeRankingSessions(sql)
          yield* sql.unsafe(
            `UPDATE session_nodes
            SET content_json = json_object('text', 'markernative ' ||
              replace(hex(zeroblob(CAST(substr(session_id, 8) AS INTEGER) % ?)), '00', 'filler '))
            WHERE session_id LIKE 'native-%'`,
            [signatureCount],
          )
          yield* compareNativeRanking(sql)
          return yield* captureNativeRanking(sql, nativeRankingRequest())
        }),
      )
      expect(captured.rows).toHaveLength(501)
      expect(nativeScoreCalls(path.join(temporaryRoot, 'search.sqlite'), captured)).toEqual({
        groups: 0,
        fallback: 1200,
      })
    },
  )

  it('uses native Unicode-folded facts and archived representatives without truncating visible members', async () => {
    const result = await runtime.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* seedNativeRankingSessions(sql)
        yield* sql`UPDATE session_nodes SET content_json = ${'{"text":"CAFÉ CAFÉ résumé"}'}
          WHERE session_id LIKE ${'native-%'}`
        yield* sql`UPDATE sessions SET archived = 1 WHERE id < ${'native-0600'}`
        const representatives = yield* sql.unsafe(`
          SELECT content.c1 AS archived
          FROM session_discovery_term_signatures AS signatures
          JOIN session_node_discovery_search_content AS content
            ON content.id = signatures.representative_rowid
          WHERE signatures.term = 'cafe'
        `)
        expect(representatives).toEqual([{ archived: 1 }])
        const rows = yield* compareNativeRanking(sql, { query: 'cafe' })
        expect(rows).toHaveLength(501)
        expect(rows[0]?.session_id).toBe('native-0600')
        const archived = yield* compareNativeRanking(sql, { query: 'CAFE', includeArchived: true })
        expect(archived[0]?.session_id).toBe('native-0000')
        return yield* captureNativeRanking(sql, nativeRankingRequest({ query: 'cafe' }))
      }),
    )
    expect(nativeScoreCalls(path.join(temporaryRoot, 'search.sqlite'), result)).toEqual({
      groups: 1,
      fallback: 0,
    })
  })

  it.each([
    '"markernative"',
    '"markernative markernative"',
    'markernative filler',
    'markernative_filler',
    'CAFÉ',
  ])('retains the original FTS path for non-single-ASCII-token query %j', async (query) => {
    const captured = await runtime.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* seedNativeRankingSessions(sql)
        yield* compareNativeRanking(sql, { query })
        return yield* captureNativeRanking(sql, nativeRankingRequest({ query }))
      }),
    )
    expect(captured.query).not.toContain('session_discovery_term_signatures')
  })

  it('retains the original FTS path for project, WorkingPath and restricted authority', async () => {
    await runtime.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        for (const overrides of [{ projectPath: '/project-a' }, { workingPath: '/project-a' }]) {
          const result = yield* captureNativeRanking(sql, nativeRankingRequest(overrides))
          expect(result.query).not.toContain('session_discovery_term_signatures')
        }
        const result = yield* captureNativeRanking(sql, nativeRankingRequest(), {
          profileId: 'restricted',
          profileName: 'Restricted',
          capabilities: ['sessions:discover'],
          scope: { sessionIds: ['worker'] },
          authorizationCeiling: 'ask-for-approval',
        })
        expect(result.query).not.toContain('session_discovery_term_signatures')
      }),
    )
  })

  it('retains complete rows with tied unequal-column signatures and competing evidence sources', async () => {
    const result = await runtime.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* seedNativeRankingSessions(sql, 2400)
        yield* sql.unsafe(`UPDATE session_nodes SET content_json = json_object('text',
          CASE WHEN CAST(substr(session_id, 8) AS INTEGER) % 2 = 0
            THEN 'markernative markernative markernative' ELSE 'markernative' END)
          WHERE session_id LIKE 'native-%'`)
        yield* sql.unsafe(`INSERT INTO session_nodes (
          id, session_id, kind, role, timestamp_ms, content_json, metadata_json, created_order
        ) SELECT id || '-preview', id, 'message', 'assistant', 2,
          json_object('text', CASE WHEN CAST(substr(id, 8) AS INTEGER) % 2 = 0
            THEN 'markernative' ELSE 'markernative markernative markernative' END), '{}', 1
          FROM sessions WHERE id LIKE 'native-%'`)
        yield* sql`UPDATE sessions SET title = ${'markernative secondary'}
          WHERE id = ${'native-2399'}`
        yield* sql`UPDATE sessions SET project_path = ${'/markernative'}
          WHERE id = ${'native-2398'}`
        yield* sql`UPDATE delegation_specifications SET specification_json =
          ${'{"objective":"markernative","deliverables":[],"acceptanceCriteria":[],"resourceReferences":[]}'}
          WHERE delegation_id = ${'delegation-worker'}`
        const request = nativeRankingRequest()
        const actual = yield* captureNativeRanking(sql, request)
        expect(actual.rows).toEqual(yield* legacyDiscoveryRanking(sql, request))
        expect(actual.rows.some((row) => row.matched_fields.includes('title'))).toBe(true)
        expect(actual.rows.some((row) => row.matched_fields.includes('project'))).toBe(true)
        expect(actual.rows.some((row) => row.matched_fields.includes('objective'))).toBe(true)
        return actual
      }),
    )
    expect(nativeScoreCalls(path.join(temporaryRoot, 'search.sqlite'), result)).toEqual({
      groups: 2,
      fallback: 0,
    })
  })
})

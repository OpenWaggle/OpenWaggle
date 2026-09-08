import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import * as SqlClient from '@effect/sql/SqlClient'
import * as Statement from '@effect/sql/Statement'
import { SESSION_QUERY_CONTRACT_VERSION } from '@shared/types/session-query'
import * as Effect from 'effect/Effect'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { refreshSessionTranscriptTerms } from '../../services/session-transcript-term-projection'
import { loadLexicalDiscoveryRows } from '../sqlite-session-lexical-search'
import { makeSessionQueryRuntime } from './sqlite-session-query-test-layer'

describe('SQLite phrase search evidence query plan', () => {
  let temporaryRoot = ''
  let runtime: ReturnType<typeof makeSessionQueryRuntime>

  beforeEach(async () => {
    temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-phrase-plan-'))
    runtime = makeSessionQueryRuntime(path.join(temporaryRoot, 'search.sqlite'))
  })

  afterEach(async () => {
    await runtime.dispose()
    await fs.rm(temporaryRoot, { recursive: true, force: true })
  })

  it('retains the first phrase evidence without repeating FTS probes for candidate nodes', async () => {
    const result = await runtime.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* sql`
          UPDATE session_nodes SET content_json = ${'{"text":"search phrase"}'}
          WHERE id = ${'node-worker-2'}
        `
        yield* sql`
          INSERT INTO session_nodes (
            id, session_id, kind, role, timestamp_ms, content_json,
            metadata_json, branch_hint_id, created_order
          ) VALUES (
            ${'a-later-phrase-node'}, ${'worker'}, ${'message'}, ${'assistant'}, ${3},
            ${'{"text":"search phrase"}'}, ${'{"openWaggle":{"runId":"run-worker"}}'},
            ${'worker:branch:main'}, ${2}
          )
        `
        yield* refreshSessionTranscriptTerms(sql, ['worker'])
        let queryStatement: Statement.Statement<unknown> | undefined
        const rows = yield* Statement.withTransformer(
          loadLexicalDiscoveryRows(sql, undefined, {
            contractVersion: SESSION_QUERY_CONTRACT_VERSION,
            requestId: 'phrase-query-plan',
            query: {
              operation: 'search',
              query: '"search phrase"',
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
        if (!queryStatement) throw new Error('Phrase search did not execute a query.')
        const [query, parameters] = queryStatement.compile()
        const plan = yield* sql.unsafe<{ readonly detail: string }>(
          `EXPLAIN QUERY PLAN ${query}`,
          parameters,
        )
        return { rows, plan: plan.map((step) => step.detail) }
      }),
    )

    expect(result.rows).toEqual([
      expect.objectContaining({
        session_id: 'worker',
        transcript_node_id: 'node-worker-2',
        transcript_created_order: 1,
        transcript_run_id: 'run-worker-2',
      }),
    ])
    expect(
      result.plan.some((step) => /session_node_search .*VIRTUAL TABLE INDEX .*=[^:]*M/u.test(step)),
    ).toBe(false)
  })
})

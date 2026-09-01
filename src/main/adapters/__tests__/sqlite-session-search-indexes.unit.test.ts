import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import * as SqlClient from '@effect/sql/SqlClient'
import * as Effect from 'effect/Effect'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { sessionTranscriptSearchContentSql } from '../../services/session-transcript-search-content-sql'
import { makeSessionQueryRuntime as makeRuntime } from './sqlite-session-query-test-layer'

describe('SQLite Session search indexes', () => {
  let temporaryRoot = ''
  const runtimes: Array<ReturnType<typeof makeRuntime>> = []

  beforeEach(async () => {
    temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-search-indexes-'))
  })

  afterEach(async () => {
    await Promise.all(runtimes.splice(0).map((runtime) => runtime.dispose()))
    await fs.rm(temporaryRoot, { recursive: true, force: true })
  })

  it('reads the semantic queue in index order and maintains FTS rowid mappings', async () => {
    const runtime = makeRuntime(path.join(temporaryRoot, 'query-plan.sqlite'))
    runtimes.push(runtime)
    const result = await runtime.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        const queuePlan = yield* sql<{ readonly detail: string }>`
          EXPLAIN QUERY PLAN
          SELECT queue.session_id
          FROM session_discovery_embedding_queue AS queue
          JOIN sessions ON sessions.id = queue.session_id
          ORDER BY queue.queued_at, queue.session_id
          LIMIT ${10}
        `
        yield* sql`
          UPDATE session_nodes SET content_json = ${'{"text":"updated rowid projection"}'}
          WHERE id = ${'node-worker-1'}
        `
        const updated = yield* sql<{
          readonly search_rowid: number
          readonly discovery_search_rowid: number
          readonly content: string
        }>`
          SELECT search_rows.search_rowid, search_rows.discovery_search_rowid, search.content
          FROM session_node_search_rows AS search_rows
          JOIN session_node_search AS search ON search.rowid = search_rows.search_rowid
          WHERE search_rows.node_id = ${'node-worker-1'}
        `
        yield* sql`DELETE FROM session_nodes WHERE id = ${'node-worker-1'}`
        const deleted = yield* sql<{ readonly count: number }>`
          SELECT
            (SELECT COUNT(*) FROM session_node_search_rows
              WHERE node_id = ${'node-worker-1'})
            + (SELECT COUNT(*) FROM session_node_search
              WHERE rowid = ${updated[0]?.search_rowid ?? -1})
            + (SELECT COUNT(*) FROM session_node_discovery_search
              WHERE rowid = ${updated[0]?.discovery_search_rowid ?? -1}) AS count
        `
        return { queuePlan, updated, deleted }
      }),
    )

    const details = result.queuePlan.map((row) => row.detail).join('\n')
    expect(details).toContain('idx_session_discovery_embedding_queue_order')
    expect(details).not.toContain('USE TEMP B-TREE FOR ORDER BY')
    expect(result.updated).toMatchObject([{ content: 'updated rowid projection' }])
    expect(result.deleted).toEqual([{ count: 0 }])
  })

  it('scopes transcript semantic admission by Session without traversing FTS', async () => {
    const runtime = makeRuntime(path.join(temporaryRoot, 'semantic-scope-plan.sqlite'))
    runtimes.push(runtime)
    const plan = await runtime.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        return yield* sql<{ readonly detail: string }>`
          EXPLAIN QUERY PLAN
          SELECT nodes.id
          FROM session_nodes AS nodes
          JOIN session_transcript_semantic_scopes AS scopes
            ON scopes.session_id = nodes.session_id
          WHERE nodes.session_id IN ${sql.in(['worker'])}
            AND trim(${sql.literal(sessionTranscriptSearchContentSql('nodes'))}) <> ''
          ORDER BY nodes.created_order DESC, nodes.id DESC
        `
      }),
    )

    const details = plan.map((row) => row.detail).join('\n')
    expect(details).toMatch(/idx_session_nodes_(?:run|session)_created_order/)
    expect(details).not.toContain('session_node_search')
  })
})

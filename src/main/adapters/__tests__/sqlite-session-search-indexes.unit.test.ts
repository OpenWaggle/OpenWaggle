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

  it('reads the semantic queue in index order and maintains compact discovery rows', async () => {
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
        const discoveryPlan = yield* sql<{ readonly detail: string }>`
          EXPLAIN QUERY PLAN
          SELECT session_id FROM session_node_discovery_search
          WHERE current_preview MATCH ${'second'}
        `
        yield* sql`
          UPDATE session_nodes SET role = ${'user'} WHERE id = ${'node-worker-1'}
        `
        const before = yield* sql<{
          readonly initial_objective: string
          readonly current_preview: string
        }>`
          SELECT discovery.initial_objective, discovery.current_preview
          FROM session_discovery_search_rows AS rows
          JOIN session_node_discovery_search AS discovery ON discovery.rowid = rows.search_rowid
          WHERE rows.session_id = ${'worker'}
        `
        yield* sql`
          UPDATE session_nodes SET content_json = ${'{"text":"updated historical projection"}'}
          WHERE id = ${'node-worker-1'}
        `
        const afterHistoricalUpdate = yield* sql<{ readonly current_preview: string }>`
          SELECT discovery.current_preview
          FROM session_discovery_search_rows AS rows
          JOIN session_node_discovery_search AS discovery ON discovery.rowid = rows.search_rowid
          WHERE rows.session_id = ${'worker'}
        `
        yield* sql`
          UPDATE session_nodes SET content_json = ${'{"text":"updated current projection"}'}
          WHERE id = ${'node-worker-2'}
        `
        const updated = yield* sql<{
          readonly search_rowid: number
          readonly current_preview: string
        }>`
          SELECT search_rows.search_rowid, discovery.current_preview
          FROM session_node_search_rows AS search_rows
          JOIN session_node_search AS search ON search.rowid = search_rows.search_rowid
          JOIN session_discovery_search_rows AS discovery_rows
            ON discovery_rows.session_id = search_rows.session_id
          JOIN session_node_discovery_search AS discovery
            ON discovery.rowid = discovery_rows.search_rowid
          WHERE search_rows.node_id = ${'node-worker-2'}
        `
        yield* sql`DELETE FROM session_nodes WHERE id = ${'node-worker-2'}`
        const afterDelete = yield* sql<{
          readonly current_preview: string
          readonly deleted_node_count: number
          readonly discovery_row_count: number
        }>`
          SELECT discovery.current_preview,
            (SELECT COUNT(*) FROM session_node_search_rows
              WHERE node_id = ${'node-worker-2'}) AS deleted_node_count,
            (SELECT COUNT(*) FROM session_discovery_search_rows
              WHERE session_id = ${'worker'}) AS discovery_row_count
          FROM session_discovery_search_rows AS rows
          JOIN session_node_discovery_search AS discovery ON discovery.rowid = rows.search_rowid
          WHERE rows.session_id = ${'worker'}
        `
        return { queuePlan, discoveryPlan, before, afterHistoricalUpdate, updated, afterDelete }
      }),
    )

    const details = result.queuePlan.map((row) => row.detail).join('\n')
    expect(details).toContain('idx_session_discovery_embedding_queue_order')
    expect(details).not.toContain('USE TEMP B-TREE FOR ORDER BY')
    expect(result.discoveryPlan.map((row) => row.detail).join('\n')).toMatch(
      /session_node_discovery_search VIRTUAL TABLE INDEX/,
    )
    expect(result.before).toEqual([
      {
        initial_objective: 'neural handshake verifier',
        current_preview: 'second page write_file',
      },
    ])
    expect(result.afterHistoricalUpdate).toEqual([{ current_preview: 'second page write_file' }])
    expect(result.updated).toMatchObject([{ current_preview: 'updated current projection' }])
    expect(result.afterDelete).toEqual([
      {
        current_preview: 'updated historical projection',
        deleted_node_count: 0,
        discovery_row_count: 1,
      },
    ])
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

  it('removes the compact discovery row when its Session is deleted', async () => {
    const runtime = makeRuntime(path.join(temporaryRoot, 'discovery-delete.sqlite'))
    runtimes.push(runtime)
    const remaining = await runtime.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        const rows = yield* sql<{ readonly search_rowid: number }>`
          SELECT search_rowid FROM session_discovery_search_rows WHERE session_id = ${'other'}
        `
        yield* sql`DELETE FROM sessions WHERE id = ${'other'}`
        return yield* sql<{ readonly count: number }>`
          SELECT
            (SELECT COUNT(*) FROM session_discovery_search_rows WHERE session_id = ${'other'})
            + (SELECT COUNT(*) FROM session_node_discovery_search
              WHERE rowid = ${rows[0]?.search_rowid ?? -1}) AS count
        `
      }),
    )

    expect(remaining).toEqual([{ count: 0 }])
  })
})

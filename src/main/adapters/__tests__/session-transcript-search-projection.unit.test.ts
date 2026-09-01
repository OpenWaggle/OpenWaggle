import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import * as SqlClient from '@effect/sql/SqlClient'
import * as Effect from 'effect/Effect'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  refreshSessionTranscriptSearch,
  SESSION_TRANSCRIPT_SEARCH_CHUNK_NODE_LIMIT,
} from '../../services/session-transcript-search-projection'
import { executeSessionQuery, makeSessionQueryRuntime } from './sqlite-session-query-test-layer'

const MAX_NODE_SEARCH_CONTENT_LENGTH = 12_000

describe('Session transcript search projection', () => {
  let root = ''
  let runtime: ReturnType<typeof makeSessionQueryRuntime> | undefined

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-transcript-chunks-'))
    runtime = makeSessionQueryRuntime(path.join(root, 'chunks.sqlite'))
  })

  afterEach(async () => {
    await runtime?.dispose()
    runtime = undefined
    await fs.rm(root, { recursive: true, force: true })
  })

  it('keeps long-Session FTS documents bounded while retaining complete recall', async () => {
    if (!runtime) throw new Error('Runtime missing.')
    const chunkStats = await runtime.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* sql.unsafe(`
          WITH RECURSIVE sequence(value) AS (
            SELECT 0 UNION ALL SELECT value + 1 FROM sequence WHERE value < 128
          )
          INSERT INTO session_nodes (
            id, session_id, parent_id, kind, role, timestamp_ms,
            content_json, metadata_json, branch_hint_id, created_order
          )
          SELECT printf('skew-%03d', value), 'worker', NULL, 'message', 'assistant', 1000 + value,
            json_object('text', CASE WHEN value = 128
              THEN printf('%.*c', ${MAX_NODE_SEARCH_CONTENT_LENGTH - 100}, 'x') ||
                ' terminal-skew-marker'
              ELSE printf('%.*c', ${MAX_NODE_SEARCH_CONTENT_LENGTH}, 'x')
            END), '{}', NULL, 1000 + value
          FROM sequence
        `)
        yield* refreshSessionTranscriptSearch(sql, ['worker'])
        return yield* sql<{
          readonly chunk_count: number
          readonly max_length: number
          readonly terminal_terms: number
        }>`
          SELECT COUNT(*) AS chunk_count, MAX(length(content)) AS max_length,
            (SELECT COUNT(*) FROM session_transcript_terms
              WHERE session_id = ${'worker'} AND term = ${'terminal'}) AS terminal_terms
          FROM session_transcript_search WHERE session_id = ${'worker'}
        `
      }),
    )
    const result = await executeSessionQuery(runtime, {
      operation: 'search',
      query: 'terminal-skew-marker',
      searchScope: 'full-transcript',
      mode: 'lexical',
      limit: 10,
    })

    expect(chunkStats[0]?.chunk_count).toBe(3)
    expect(chunkStats[0]?.terminal_terms).toBe(1)
    expect(chunkStats[0]?.max_length).toBeLessThanOrEqual(
      SESSION_TRANSCRIPT_SEARCH_CHUNK_NODE_LIMIT * (MAX_NODE_SEARCH_CONTENT_LENGTH + 1),
    )
    expect(result.outcome).toMatchObject({
      operation: 'search',
      sessions: [{ sessionId: 'worker' }],
    })
  })
})

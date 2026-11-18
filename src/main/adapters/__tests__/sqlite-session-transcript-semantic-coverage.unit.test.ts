import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import * as SqlClient from '@effect/sql/SqlClient'
import * as Effect from 'effect/Effect'
import { expect, it } from 'vitest'
import type { SessionEmbeddingModel } from '../multilingual-e5-session-embedding-model'
import { SqliteSessionTranscriptSemanticProjection } from '../sqlite-session-transcript-semantic-projection'
import { makeSessionQueryRuntime } from './sqlite-session-query-test-layer'

const model: SessionEmbeddingModel = {
  metadata: { id: 'test/transcript', revision: 'test-1', dimensions: 2, dtype: 'test' },
  embedQueries: async (texts) => texts.map(() => new Float32Array([1, 0])),
  embedPassages: async (texts) => texts.map(() => new Float32Array([1, 0])),
}

it('refreshes scoped coverage lazily after deleting an indexed transcript node', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-scope-delete-'))
  const runtime = makeSessionQueryRuntime(path.join(root, 'scope-delete.sqlite'), model)
  try {
    const result = await runtime.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        const projection = new SqliteSessionTranscriptSemanticProjection(sql, model)
        yield* projection.ensureSessions(['worker'])
        while ((yield* projection.prepareNextBatch(10)).prepared > 0) {
          // Prepare the complete bounded scope once.
        }
        yield* sql`DELETE FROM session_nodes WHERE id = ${'node-worker-1'}`
        yield* projection.ensureSessions(['worker'])
        const rows = yield* sql<{
          readonly searchable_node_count: number
          readonly eligible_node_count: number
          readonly coverage_limited: number
          readonly coverage_limit_reason: string | null
        }>`
          SELECT searchable_node_count, eligible_node_count,
            coverage_limited, coverage_limit_reason
          FROM session_transcript_semantic_scopes WHERE session_id = ${'worker'}
        `
        return { readiness: yield* projection.readiness(['worker']), scope: rows[0] }
      }),
    )
    expect(result.readiness).toMatchObject({ status: 'ready', coverage: 1, pendingCount: 0 })
    expect(result.scope).toEqual({
      searchable_node_count: 1,
      eligible_node_count: 1,
      coverage_limited: 0,
      coverage_limit_reason: null,
    })
  } finally {
    await runtime.dispose()
    await fs.rm(root, { recursive: true, force: true })
  }
})

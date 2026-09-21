import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import * as SqlClient from '@effect/sql/SqlClient'
import * as Effect from 'effect/Effect'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { SessionEmbeddingModel } from '../multilingual-e5-session-embedding-model'
import {
  executeSessionQuery as executeQuery,
  makeSessionQueryRuntime as makeRuntime,
} from './sqlite-session-query-test-layer'

const PRIVATE_MARKER = 'neural handshake verifier'
const PRIVATE_QUERY = 'private verification protocol'
const embeddingModel: SessionEmbeddingModel = {
  metadata: { id: 'test/transcript-authority', revision: 'test-1', dimensions: 2, dtype: 'test' },
  embedQueries: async (texts) =>
    texts.map((text) =>
      text.includes(PRIVATE_QUERY) ? new Float32Array([1, 0]) : new Float32Array([0, 1]),
    ),
  embedPassages: async (texts) =>
    texts.map((text) =>
      text.includes(PRIVATE_MARKER) ? new Float32Array([1, 0]) : new Float32Array([0, 1]),
    ),
}

describe('SQLite Session transcript Host authority boundary', () => {
  let root = ''
  let runtime: ReturnType<typeof makeRuntime>

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-transcript-authority-'))
    runtime = makeRuntime(path.join(root, 'authority.sqlite'), embeddingModel)
    await runtime.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* sql`
          INSERT INTO session_nodes (
            id, session_id, kind, role, timestamp_ms, content_json,
            metadata_json, branch_hint_id, created_order
          ) VALUES (
            ${'node-private-other'}, ${'other'}, ${'message'}, ${'assistant'}, ${1},
            ${JSON.stringify({ text: PRIVATE_MARKER })}, ${'{}'}, ${null}, ${0}
          )
        `
      }),
    )
  })

  afterEach(async () => {
    await runtime.dispose()
    await fs.rm(root, { recursive: true, force: true })
  })

  it('never prepares or reports transcript evidence outside the authorized project', async () => {
    const authority = {
      profileId: 'mcp-scoped',
      profileName: 'mcp-scoped',
      capabilities: ['sessions:discover' as const, 'sessions:read' as const],
      scope: { projectPaths: ['/project-a'] },
      authorizationCeiling: 'ask-for-approval' as const,
    }
    const semantic = await executeQuery(
      runtime,
      {
        operation: 'search',
        query: PRIVATE_QUERY,
        searchScope: 'full-transcript',
        mode: 'semantic',
        limit: 10,
      },
      authority,
      'transient-mcp:test',
    )
    const lexical = await executeQuery(
      runtime,
      {
        operation: 'search',
        query: PRIVATE_MARKER,
        searchScope: 'full-transcript',
        mode: 'lexical',
        projectPath: '/project-b',
        limit: 10,
      },
      authority,
      'transient-mcp:test',
    )
    const rows = await runtime.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        return yield* sql<{ readonly private_scope: number; readonly private_queue: number }>`
          SELECT
            (SELECT COUNT(*) FROM session_transcript_semantic_scopes
              WHERE session_id = ${'other'}) AS private_scope,
            (SELECT COUNT(*) FROM session_transcript_embedding_queue
              WHERE session_id = ${'other'}) AS private_queue
        `
      }),
    )

    expect(semantic.outcome).toMatchObject({
      operation: 'search',
      error: { code: 'semantic_not_ready' },
      semanticReadiness: { pendingCount: 2 },
    })
    expect(lexical.outcome).toMatchObject({
      operation: 'search',
      sessions: [],
      discoveryWindow: { size: 0, truncated: false },
    })
    expect(rows[0]).toEqual({ private_scope: 0, private_queue: 0 })
  })
})

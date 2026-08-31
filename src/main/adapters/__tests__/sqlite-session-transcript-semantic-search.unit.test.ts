import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import * as SqlClient from '@effect/sql/SqlClient'
import * as Effect from 'effect/Effect'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { SessionEmbeddingModel } from '../multilingual-e5-session-embedding-model'
import { sessionTranscriptDocument } from '../session-transcript-document'
import { SessionTranscriptSemanticIndexCache } from '../session-transcript-semantic-index-cache'
import { SqliteSessionSemanticProjection } from '../sqlite-session-semantic-projection'
import { SqliteSessionTranscriptSemanticProjection } from '../sqlite-session-transcript-semantic-projection'
import {
  executeSessionQuery as executeQuery,
  makeSessionQueryRuntime as makeRuntime,
} from './sqlite-session-query-test-layer'

const OLDER_TRANSCRIPT_MARKER = 'neural handshake verifier'
const OLDER_TRANSCRIPT_QUERY = 'private verification protocol'

const transcriptPrivacyModel: SessionEmbeddingModel = {
  metadata: { id: 'test/transcript-embedding', revision: 'test-1', dimensions: 2, dtype: 'test' },
  embedQueries: async (texts) =>
    texts.map((text) =>
      text.includes(OLDER_TRANSCRIPT_QUERY) ? new Float32Array([1, 0]) : new Float32Array([0, 1]),
    ),
  embedPassages: async (texts) =>
    texts.map((text) =>
      text.includes(OLDER_TRANSCRIPT_MARKER) ? new Float32Array([1, 0]) : new Float32Array([0, 1]),
    ),
}

describe('SQLite Session transcript semantic search', () => {
  let root = ''
  const runtimes: Array<ReturnType<typeof makeRuntime>> = []

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-transcript-semantic-'))
  })

  afterEach(async () => {
    await Promise.all(runtimes.splice(0).map((runtime) => runtime.dispose()))
    await fs.rm(root, { recursive: true, force: true })
  })

  it('projects only safe, user-visible transcript content', () => {
    const message = sessionTranscriptDocument({
      kind: 'assistant_message',
      role: 'assistant',
      contentJson: JSON.stringify({
        parts: [
          { type: 'text', text: 'Visible answer' },
          { type: 'reasoning', text: 'private reasoning' },
          {
            type: 'tool-call',
            toolCall: { name: 'read_file', args: { token: 'private argument' } },
          },
          {
            type: 'attachment',
            attachment: { name: 'requirements.txt', extractedText: 'private attachment body' },
          },
        ],
      }),
    })
    const toolResult = sessionTranscriptDocument({
      kind: 'tool_result',
      role: null,
      contentJson: JSON.stringify({
        parts: [
          {
            type: 'tool-result',
            toolResult: {
              name: 'read_file',
              isError: false,
              result: { content: [{ type: 'text', text: 'private result body' }] },
            },
          },
        ],
      }),
    })
    const orchestration = sessionTranscriptDocument({
      kind: 'custom',
      role: null,
      contentJson: JSON.stringify({
        customType: 'openwaggle-orchestration-update',
        content: 'Worker review is ready.',
        display: true,
      }),
    })
    const hidden = sessionTranscriptDocument({
      kind: 'custom',
      role: null,
      contentJson: JSON.stringify({
        customType: 'private-internal-update',
        content: 'private custom body',
        display: true,
      }),
    })

    expect(message).toBe('Visible answer\nread_file\nrequirements.txt')
    expect(toolResult).toBe('read_file completed')
    expect(orchestration).toBe('Worker review is ready.')
    expect(hidden).toBe('')
  })

  it('lazily projects an authorized bounded scope and finds an older semantic turn', async () => {
    const runtime = makeRuntime(path.join(root, 'older-turn.sqlite'), transcriptPrivacyModel)
    runtimes.push(runtime)

    const preparing = await executeQuery(runtime, {
      operation: 'search',
      query: OLDER_TRANSCRIPT_QUERY,
      searchScope: 'full-transcript',
      mode: 'semantic',
      limit: 1,
    })
    expect(preparing.outcome).toMatchObject({
      operation: 'search',
      error: { code: 'semantic_not_ready' },
      semanticReadiness: { status: 'preparing', pendingCount: 2 },
    })

    await runtime.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        const projection = new SqliteSessionTranscriptSemanticProjection(
          sql,
          transcriptPrivacyModel,
        )
        while ((yield* projection.prepareNextBatch(10)).prepared > 0) {
          // Drain only the explicitly requested transcript scope.
        }
      }),
    )

    const result = await executeQuery(runtime, {
      operation: 'search',
      query: OLDER_TRANSCRIPT_QUERY,
      searchScope: 'full-transcript',
      mode: 'semantic',
      limit: 1,
    })
    expect(result.outcome).toMatchObject({
      operation: 'search',
      searchBackend: 'semantic',
      semanticReadiness: { status: 'ready', pendingCount: 0 },
      sessions: [
        {
          sessionId: 'worker',
          discoveryEvidence: {
            matchedFields: ['transcript'],
            transcriptMatch: {
              nodeId: 'node-worker-1',
              runId: 'run-worker',
              createdOrder: 0,
            },
          },
        },
      ],
    })

    const hybrid = await executeQuery(runtime, {
      operation: 'search',
      query: OLDER_TRANSCRIPT_MARKER,
      searchScope: 'full-transcript',
      mode: 'hybrid',
      limit: 1,
    })
    expect(hybrid.outcome).toMatchObject({
      operation: 'search',
      searchBackend: 'hybrid',
      sessions: [
        {
          sessionId: 'worker',
          discoveryEvidence: {
            matchKind: 'hybrid',
            matchedFields: ['transcript'],
            transcriptMatch: {
              nodeId: 'node-worker-1',
              runId: 'run-worker',
              createdOrder: 0,
            },
          },
        },
      ],
    })
  })

  it('does not queue empty internal nodes for transcript embeddings', async () => {
    const runtime = makeRuntime(path.join(root, 'empty-nodes.sqlite'), transcriptPrivacyModel)
    runtimes.push(runtime)

    const counts = await runtime.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* sql`
          INSERT INTO session_nodes (
            id, session_id, kind, role, timestamp_ms, content_json,
            metadata_json, branch_hint_id, created_order
          ) VALUES (
            ${'node-worker-hidden'}, ${'worker'}, ${'custom'}, NULL, ${3},
            ${JSON.stringify({
              customType: 'private-internal-update',
              content: 'private custom body',
              display: true,
            })}, ${'{}'}, ${'worker:branch:main'}, ${2}
          )
        `
        const projection = new SqliteSessionTranscriptSemanticProjection(
          sql,
          transcriptPrivacyModel,
        )
        yield* projection.ensureSessions(['worker'])
        return yield* sql<{ readonly indexed: number; readonly queued: number }>`
          SELECT
            (SELECT COUNT(*) FROM session_node_search
              WHERE node_id = ${'node-worker-hidden'} AND trim(content) <> '') AS indexed,
            (SELECT COUNT(*) FROM session_transcript_embedding_queue
              WHERE node_id = ${'node-worker-hidden'}) AS queued
        `
      }),
    )

    expect(counts[0]).toEqual({ indexed: 0, queued: 0 })
  })

  it('keeps private older chunks outside discover-only semantic search', async () => {
    const runtime = makeRuntime(path.join(root, 'discover-only.sqlite'), transcriptPrivacyModel)
    runtimes.push(runtime)
    await runtime.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* new SqliteSessionSemanticProjection(sql, transcriptPrivacyModel).prepareNextBatch(10)
      }),
    )

    const result = await executeQuery(
      runtime,
      { operation: 'search', query: OLDER_TRANSCRIPT_QUERY, mode: 'semantic', limit: 1 },
      {
        profileId: 'discover-only',
        profileName: 'discover-only',
        capabilities: ['sessions:discover'],
        scope: { projectPaths: ['/project-a'] },
        authorizationCeiling: 'ask-for-approval',
      },
    )

    expect(JSON.stringify(result)).not.toContain('worker')
    const scopedRows = await runtime.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        return yield* sql<{ readonly count: number }>`
          SELECT COUNT(*) AS count FROM session_transcript_semantic_scopes
        `
      }),
    )
    expect(scopedRows[0]?.count).toBe(0)
  })

  it('shares one scoped vector hydration across concurrent searches and reconciles deletion', async () => {
    const runtime = makeRuntime(path.join(root, 'scope-cache.sqlite'), transcriptPrivacyModel)
    runtimes.push(runtime)

    const result = await runtime.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        const projection = new SqliteSessionTranscriptSemanticProjection(
          sql,
          transcriptPrivacyModel,
        )
        yield* projection.ensureSessions(['worker'])
        while ((yield* projection.prepareNextBatch(10)).prepared > 0) {
          // Prepare the complete bounded scope once.
        }
        const cache = new SessionTranscriptSemanticIndexCache(sql, transcriptPrivacyModel)
        const indexes = yield* Effect.all(
          Array.from({ length: 8 }, () => cache.load(['worker'])),
          { concurrency: 'unbounded' },
        )
        const before = cache.diagnostics()
        yield* sql`
          DELETE FROM session_transcript_embeddings WHERE node_id = ${'node-worker-1'}
        `
        const reconciled = yield* cache.load(['worker'])
        return { indexes, before, after: cache.diagnostics(), reconciled }
      }),
    )

    expect(new Set(result.indexes).size).toBe(1)
    expect(result.before).toEqual({ cachedScopes: 1, cachedRecords: 2, fullRebuilds: 1 })
    expect(result.after).toEqual({ cachedScopes: 1, cachedRecords: 1, fullRebuilds: 1 })
    expect(
      result.reconciled.searchGrouped(new Float32Array([1, 0]), 2, new Set(['worker'])),
    ).toEqual([expect.objectContaining({ sessionId: 'worker', matchedRecordId: 'node-worker-2' })])
  })
})

import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import * as SqlClient from '@effect/sql/SqlClient'
import { SessionId } from '@shared/types/brand'
import * as Effect from 'effect/Effect'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProjectedSessionNodeInput } from '../../ports/session-repository'
import { refreshSessionTranscriptTerms } from '../../services/session-transcript-term-projection'
import { createSession, persistSessionSnapshot } from '../session-details'
import { mainBranchId } from '../session-details/branch-utils'
import { runStoreEffect } from '../store-runtime'

const NODE_COUNT = 10_000
const APPENDED_NODE_INDEX = NODE_COUNT
// A one-node append must not rebuild the complete 10k-node transcript term projection.
const APPEND_PERSISTENCE_BUDGET_MS = 2_000

const { state, getPathMock } = vi.hoisted(() => ({
  state: { userDataDir: '' },
  getPathMock: vi.fn(() => ''),
}))

getPathMock.mockImplementation(() => state.userDataDir)

vi.mock('electron', () => ({
  app: { getPath: getPathMock },
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: (value: string) => Buffer.from(value, 'utf8'),
    decryptString: (value: Buffer) => value.toString('utf8'),
  },
}))

beforeEach(async () => {
  state.userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ow-snapshot-semantic-'))
  const { resetAppRuntimeForTests } = await import('../../runtime')
  await resetAppRuntimeForTests()
})

afterEach(async () => {
  const temporaryRoot = state.userDataDir
  const { resetAppRuntimeForTests } = await import('../../runtime')
  await resetAppRuntimeForTests()
  await fs.rm(temporaryRoot, { recursive: true, force: true })
})

function nodeId(index: number) {
  return `node-${String(index).padStart(6, '0')}`
}

function snapshotNodes(): readonly ProjectedSessionNodeInput[] {
  const existing = Array.from({ length: NODE_COUNT }, (_, index) => ({
    id: nodeId(index),
    parentId: index === 0 ? null : nodeId(index - 1),
    piEntryType: 'message',
    kind: 'assistant_message' as const,
    role: 'assistant' as const,
    timestampMs: index,
    contentJson: JSON.stringify({ text: `node ${index}` }),
    metadataJson: '{}',
    pathDepth: index,
    createdOrder: index,
  }))
  return [
    ...existing,
    {
      id: nodeId(APPENDED_NODE_INDEX),
      parentId: nodeId(NODE_COUNT - 1),
      piEntryType: 'message',
      kind: 'assistant_message' as const,
      role: 'assistant' as const,
      timestampMs: APPENDED_NODE_INDEX,
      contentJson: '{"text":"append-only terminal marker"}',
      metadataJson: '{}',
      pathDepth: APPENDED_NODE_INDEX,
      createdOrder: APPENDED_NODE_INDEX,
    },
  ]
}

describe('Session snapshot semantic retention', () => {
  it('keeps incremental terms identical to a full rebuild across edits, deletes, and branch changes', async () => {
    const session = await createSession({
      projectPath: '/tmp/incremental-transcript-terms',
      piSessionId: 'pi-incremental-transcript-terms',
    })
    const sessionId = SessionId(String(session.id))
    const initialNodes = [
      transcriptNode('a', null, 0, 'shared alpha legacy', 'run-a'),
      transcriptNode('b', 'a', 1, 'shared beta', 'run-b'),
      transcriptNode('c', 'b', 2, 'main path', 'run-c'),
      transcriptNode('fork', 'b', 3, 'shared delta', 'run-fork'),
      transcriptNode('removed', 'c', 4, 'orphan gamma', 'run-removed'),
    ]
    await persistSessionSnapshot({
      sessionId,
      piSessionId: 'pi-incremental-transcript-terms',
      activeNodeId: 'removed',
      nodes: initialNodes,
    })

    const changedNodes = [
      transcriptNode('a', null, 0, 'alpha replacement', 'run-a-edited'),
      transcriptNode('b', 'a', 1, 'shared beta', 'run-b-edited'),
      transcriptNode('c', 'b', 2, 'main path', 'run-c'),
      transcriptNode('fork', 'b', 3, 'shared delta', 'run-fork'),
      transcriptNode('appended', 'fork', 5, 'epsilon', 'run-appended'),
    ]
    await persistSessionSnapshot({
      sessionId,
      piSessionId: 'pi-incremental-transcript-terms',
      activeNodeId: 'appended',
      nodes: changedNodes,
    })

    const incremental = await readTermProjection(sessionId)
    await runStoreEffect(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* refreshSessionTranscriptTerms(sql, [sessionId])
      }),
    )
    const rebuilt = await readTermProjection(sessionId)

    expect(incremental).toEqual(rebuilt)
    expect(incremental.document).toEqual({ token_count: 9 })
    expect(incremental.terms.find((term) => term.term === 'shared')).toEqual({
      term: 'shared',
      occurrences: 2,
      first_node_id: 'b',
      first_created_order: 1,
      first_run_id: 'run-b-edited',
      term_frequency: 2 / 9,
    })
    expect(incremental.terms.some((term) => term.term === 'legacy')).toBe(false)
    expect(incremental.terms.some((term) => term.term === 'orphan')).toBe(false)

    await persistSessionSnapshot({
      sessionId,
      piSessionId: 'pi-incremental-transcript-terms',
      activeNodeId: 'c',
      nodes: changedNodes,
    })
    expect(await readTermProjection(sessionId)).toEqual(rebuilt)
  })

  it('retains embeddings and incrementally indexes one appended turn in a 10k-node snapshot', async () => {
    const session = await createSession({
      projectPath: '/tmp/semantic-retention',
      piSessionId: 'pi-semantic-retention',
    })
    const sessionId = SessionId(String(session.id))
    const branchId = mainBranchId(sessionId)
    await runStoreEffect(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* sql`
            WITH RECURSIVE sequence(value) AS (
              SELECT 0 UNION ALL SELECT value + 1 FROM sequence WHERE value + 1 < ${NODE_COUNT}
            )
            INSERT INTO session_nodes (
              id, session_id, parent_id, pi_entry_type, kind, role, timestamp_ms,
              content_json, metadata_json, branch_hint_id, path_depth, created_order
            )
            SELECT printf('node-%06d', value), ${sessionId},
              CASE WHEN value = 0 THEN NULL ELSE printf('node-%06d', value - 1) END,
              'message', 'assistant_message', 'assistant', value,
              json_object('text', printf('node %d', value)), '{}', ${branchId}, value, value
            FROM sequence
          `
        yield* sql`
            INSERT INTO session_transcript_semantic_scopes (
              session_id, requested_at, last_accessed_at, expires_at,
              node_limit, vector_bytes_per_node
            ) VALUES (${sessionId}, ${1}, ${1}, ${100_000}, ${5_000}, ${8})
          `
        yield* sql`
            INSERT INTO session_transcript_embeddings (
              node_id, session_id, model_id, model_revision, dimensions,
              source_hash, vector, snapshot_revision, created_order, updated_at
            ) VALUES (
              ${nodeId(NODE_COUNT - 1)}, ${sessionId}, ${'test/model'}, ${'revision-1'}, ${2},
              ${'stable-source'}, ${Buffer.from(new Float32Array([1, 0]).buffer)},
              ${1}, ${NODE_COUNT - 1}, ${1}
            )
          `
      }),
    )

    const startedAt = performance.now()
    await persistSessionSnapshot({
      sessionId,
      piSessionId: 'pi-semantic-retention',
      activeNodeId: nodeId(APPENDED_NODE_INDEX),
      nodes: snapshotNodes(),
    })
    const elapsedMs = performance.now() - startedAt
    const result = await runStoreEffect(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        const rows = yield* sql<{
          readonly embedding_count: number
          readonly source_hash: string | null
          readonly appended_term_count: number
        }>`
            SELECT
              (SELECT COUNT(*) FROM session_transcript_embeddings
                WHERE session_id = ${sessionId}) AS embedding_count,
              (SELECT MAX(source_hash) FROM session_transcript_embeddings
                WHERE session_id = ${sessionId}) AS source_hash,
              (SELECT occurrences FROM session_transcript_terms
                WHERE session_id = ${sessionId} AND term = ${'append'}) AS appended_term_count
          `
        return rows[0]
      }),
    )

    expect(result).toEqual({
      embedding_count: 1,
      source_hash: 'stable-source',
      appended_term_count: 1,
    })
    expect(elapsedMs).toBeLessThan(APPEND_PERSISTENCE_BUDGET_MS)
  }, 60_000)
})

function transcriptNode(
  id: string,
  parentId: string | null,
  createdOrder: number,
  text: string,
  runId: string,
): ProjectedSessionNodeInput {
  return {
    id,
    parentId,
    piEntryType: 'message',
    kind: 'assistant_message',
    role: 'assistant',
    timestampMs: createdOrder,
    contentJson: JSON.stringify({ text }),
    metadataJson: JSON.stringify({ openWaggle: { runId } }),
    pathDepth: parentId === null ? 0 : createdOrder,
    createdOrder,
  }
}

function readTermProjection(sessionId: string) {
  return runStoreEffect(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const terms = yield* sql<{
        readonly term: string
        readonly occurrences: number
        readonly first_node_id: string
        readonly first_created_order: number
        readonly first_run_id: string | null
        readonly term_frequency: number
      }>`
        SELECT term, occurrences, first_node_id, first_created_order, first_run_id, term_frequency
        FROM session_transcript_terms
        WHERE session_id = ${sessionId}
        ORDER BY term
      `
      const documents = yield* sql<{ readonly token_count: number }>`
        SELECT token_count FROM session_transcript_term_documents
        WHERE session_id = ${sessionId}
      `
      return { terms, document: documents[0] }
    }),
  )
}

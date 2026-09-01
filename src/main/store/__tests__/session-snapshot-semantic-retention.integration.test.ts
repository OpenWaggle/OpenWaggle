import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import * as SqlClient from '@effect/sql/SqlClient'
import { SessionId } from '@shared/types/brand'
import * as Effect from 'effect/Effect'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProjectedSessionNodeInput } from '../../ports/session-repository'
import { createSession, persistSessionSnapshot } from '../session-details'
import { mainBranchId } from '../session-details/branch-utils'
import { runStoreEffect } from '../store-runtime'

const NODE_COUNT = 10_000
// Keeps the regression strict enough to catch wholesale node replacement while allowing slower CI hosts.
const PERSISTENCE_BUDGET_MS = 30_000

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
  return Array.from({ length: NODE_COUNT }, (_, index) => ({
    id: nodeId(index),
    parentId: index === 0 ? null : nodeId(index - 1),
    piEntryType: 'message',
    kind: 'assistant_message' as const,
    role: 'assistant' as const,
    timestampMs: index,
    contentJson: JSON.stringify({ text: `node ${index}` }),
    metadataJson: index === NODE_COUNT - 1 ? '{"changed":true}' : '{}',
    pathDepth: index,
    createdOrder: index,
  }))
}

describe('Session snapshot semantic retention', () => {
  it('retains embeddings while reconciling a slightly changed 10k-node snapshot', async () => {
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
              ${nodeId(0)}, ${sessionId}, ${'test/model'}, ${'revision-1'}, ${2},
              ${'stable-source'}, ${Buffer.from(new Float32Array([1, 0]).buffer)},
              ${1}, ${0}, ${1}
            )
          `
      }),
    )

    const startedAt = performance.now()
    await persistSessionSnapshot({
      sessionId,
      piSessionId: 'pi-semantic-retention',
      activeNodeId: nodeId(NODE_COUNT - 1),
      nodes: snapshotNodes(),
    })
    const elapsedMs = performance.now() - startedAt
    const result = await runStoreEffect(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        const rows = yield* sql<{
          readonly embedding_count: number
          readonly source_hash: string | null
        }>`
            SELECT COUNT(*) AS embedding_count, MAX(source_hash) AS source_hash
            FROM session_transcript_embeddings
            WHERE session_id = ${sessionId}
          `
        return rows[0]
      }),
    )

    expect(result).toEqual({ embedding_count: 1, source_hash: 'stable-source' })
    expect(elapsedMs).toBeLessThan(PERSISTENCE_BUDGET_MS)
  }, 60_000)
})

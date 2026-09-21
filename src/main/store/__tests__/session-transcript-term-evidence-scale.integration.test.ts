import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import * as SqlClient from '@effect/sql/SqlClient'
import { SessionId } from '@shared/types/brand'
import * as Effect from 'effect/Effect'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { ProjectedSessionNodeInput } from '../../ports/session-repository'
import { prepareIncrementalSessionTranscriptTerms } from '../../services/session-transcript-term-incremental-projection'
import { refreshSessionTranscriptTerms } from '../../services/session-transcript-term-projection'
import { createSession, persistSessionSnapshot } from '../session-details'
import { runStoreEffect } from '../store-runtime'

const NODE_COUNT = 10_000

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
  state.userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ow-term-evidence-scale-'))
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
  return `evidence-${String(index).padStart(6, '0')}`
}

function retainedNodes(): readonly ProjectedSessionNodeInput[] {
  return Array.from({ length: NODE_COUNT - 1 }, (_, offset) => {
    const index = offset + 1
    return {
      id: nodeId(index),
      parentId: index === 1 ? null : nodeId(index - 1),
      piEntryType: 'message',
      kind: 'assistant_message' as const,
      role: 'assistant' as const,
      timestampMs: index,
      contentJson: JSON.stringify({
        text: index === 1 ? 'rare-evidence replacement' : `filler ${index}`,
      }),
      metadataJson: JSON.stringify({ openWaggle: { runId: `run-${index}` } }),
      pathDepth: index - 1,
      createdOrder: index,
    }
  })
}

it('repairs deleted first evidence without restaging the complete 10k-node transcript', async () => {
  const session = await createSession({
    projectPath: '/tmp/incremental-transcript-evidence-scale',
    piSessionId: 'pi-incremental-transcript-evidence-scale',
  })
  const sessionId = SessionId(String(session.id))

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
        SELECT printf('evidence-%06d', value), ${sessionId},
          CASE WHEN value = 0 THEN NULL ELSE printf('evidence-%06d', value - 1) END,
          'message', 'assistant_message', 'assistant', value,
          json_object('text', CASE WHEN value < 2 THEN 'rare-evidence replacement'
            ELSE printf('filler %d', value) END),
          json_object('openWaggle', json_object('runId', printf('run-%d', value))),
          NULL, value, value
        FROM sequence
      `
      yield* refreshSessionTranscriptTerms(sql, [sessionId])
      yield* prepareIncrementalSessionTranscriptTerms(sql, sessionId, [nodeId(0)])
      yield* sql.unsafe('CREATE TEMP TABLE transcript_source_insert_audit (node_id TEXT)')
      yield* sql.unsafe(`
        CREATE TEMP TRIGGER audit_transcript_source_insert
        AFTER INSERT ON session_transcript_incremental_source BEGIN
          INSERT INTO transcript_source_insert_audit (node_id) VALUES (new.node_id);
        END
      `)
    }),
  )

  await persistSessionSnapshot({
    sessionId,
    piSessionId: 'pi-incremental-transcript-evidence-scale',
    activeNodeId: nodeId(NODE_COUNT - 1),
    nodes: retainedNodes(),
  })

  const result = await runStoreEffect(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const rows = yield* sql<{
        readonly staged_rows: number
        readonly first_node_id: string
        readonly occurrences: number
      }>`
        SELECT
          (SELECT COUNT(*) FROM temp.transcript_source_insert_audit) AS staged_rows,
          terms.first_node_id,
          terms.occurrences
        FROM session_transcript_terms AS terms
        WHERE terms.session_id = ${sessionId} AND terms.term = ${'rare'}
      `
      return rows[0]
    }),
  )

  expect(result).toEqual({
    staged_rows: 1,
    first_node_id: nodeId(1),
    occurrences: 1,
  })
}, 60_000)

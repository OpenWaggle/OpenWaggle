import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import * as SqlClient from '@effect/sql/SqlClient'
import { SessionId } from '@shared/types/brand'
import * as Effect from 'effect/Effect'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createSession, persistSessionSnapshot } from '../session-details'
import { runStoreEffect } from '../store-runtime'
import { transcriptNode } from './session-snapshot-semantic-retention.test-support'

const LARGE_TERM_VOCABULARY_SIZE = 1_000

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
  state.userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ow-term-write-scale-'))
  const { resetAppRuntimeForTests } = await import('../../runtime')
  await resetAppRuntimeForTests()
})

afterEach(async () => {
  const temporaryRoot = state.userDataDir
  const { resetAppRuntimeForTests } = await import('../../runtime')
  await resetAppRuntimeForTests()
  await fs.rm(temporaryRoot, { recursive: true, force: true })
})

it('updates only changed terms when appending to a large transcript vocabulary', async () => {
  const session = await createSession({
    projectPath: '/tmp/incremental-transcript-write-scale',
    piSessionId: 'pi-incremental-transcript-write-scale',
  })
  const sessionId = SessionId(String(session.id))
  const vocabulary = Array.from(
    { length: LARGE_TERM_VOCABULARY_SIZE },
    (_, index) => `term${String(index).padStart(4, '0')}`,
  ).join(' ')
  const firstNode = transcriptNode('large-a', null, 0, `${vocabulary} common`, 'run-a')
  await persistSessionSnapshot({
    sessionId,
    piSessionId: 'pi-incremental-transcript-write-scale',
    activeNodeId: firstNode.id,
    nodes: [firstNode],
  })
  await runStoreEffect(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      yield* sql.unsafe('CREATE TABLE transcript_term_update_audit (term TEXT NOT NULL)')
      yield* sql.unsafe(`
        CREATE TRIGGER audit_transcript_term_update
        AFTER UPDATE ON session_transcript_terms BEGIN
          INSERT INTO transcript_term_update_audit (term) VALUES (new.term);
        END
      `)
    }),
  )

  await persistSessionSnapshot({
    sessionId,
    piSessionId: 'pi-incremental-transcript-write-scale',
    activeNodeId: 'large-b',
    nodes: [firstNode, transcriptNode('large-b', 'large-a', 1, 'common fresh', 'run-b')],
  })

  const result = await runStoreEffect(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const rows = yield* sql<{
        readonly token_count: number
        readonly term_count: number
        readonly updated_term_rows: number
      }>`
        SELECT
          (SELECT token_count FROM session_transcript_term_documents
            WHERE session_id = ${sessionId}) AS token_count,
          (SELECT COUNT(*) FROM session_transcript_terms
            WHERE session_id = ${sessionId}) AS term_count,
          (SELECT COUNT(*) FROM transcript_term_update_audit) AS updated_term_rows
      `
      return rows[0]
    }),
  )

  expect(result).toEqual({
    token_count: LARGE_TERM_VOCABULARY_SIZE + 3,
    term_count: LARGE_TERM_VOCABULARY_SIZE + 2,
    updated_term_rows: 3,
  })
})

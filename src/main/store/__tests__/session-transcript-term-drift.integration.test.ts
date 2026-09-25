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

/**
 * ADR 0037: the transcript-term index is derived data, so a drifted index must never cost a turn.
 *
 * Reproduced in real Electron QA: a completed run failed `persistSessionSnapshot` on
 * `CHECK constraint failed: token_count >= 0`, the renderer showed "Something went wrong", and the
 * turn was gone after a reload.
 */

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

const PI_SESSION_ID = 'pi-term-drift'

beforeEach(async () => {
  state.userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ow-term-drift-'))
  const { resetAppRuntimeForTests } = await import('../../runtime')
  await resetAppRuntimeForTests()
})

afterEach(async () => {
  const temporaryRoot = state.userDataDir
  const { resetAppRuntimeForTests } = await import('../../runtime')
  await resetAppRuntimeForTests()
  await fs.rm(temporaryRoot, { recursive: true, force: true })
})

async function seedSessionWithDriftedIndex() {
  const session = await createSession({
    projectPath: '/tmp/term-drift',
    piSessionId: PI_SESSION_ID,
  })
  const sessionId = SessionId(String(session.id))
  const first = transcriptNode('drift-a', null, 0, 'alpha beta gamma delta', 'run-a')
  const second = transcriptNode('drift-b', 'drift-a', 1, 'epsilon zeta eta theta', 'run-a')
  await persistSessionSnapshot({
    sessionId,
    piSessionId: PI_SESSION_ID,
    activeNodeId: second.id,
    nodes: [first, second],
  })
  // Drift the derived document count below the nodes' real contribution.
  await runStoreEffect(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      yield* sql`
        UPDATE session_transcript_term_documents SET token_count = 1 WHERE session_id = ${sessionId}
      `
    }),
  )
  return { sessionId, first, second }
}

function readIndexState(sessionId: SessionId) {
  return runStoreEffect(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const rows = yield* sql<{
        readonly nodes: number
        readonly token_count: number | null
        readonly occurrences: number | null
      }>`
        SELECT
          (SELECT COUNT(*) FROM session_nodes WHERE session_id = ${sessionId}) AS nodes,
          (SELECT token_count FROM session_transcript_term_documents
            WHERE session_id = ${sessionId}) AS token_count,
          (SELECT SUM(occurrences) FROM session_transcript_terms
            WHERE session_id = ${sessionId}) AS occurrences
      `
      return rows[0]
    }),
  )
}

it('persists a turn whose snapshot removes nodes from a drifted term index, and repairs the index', async () => {
  const { sessionId, first } = await seedSessionWithDriftedIndex()
  const reply = transcriptNode('drift-c', 'drift-a', 1, 'fresh reply words', 'run-b')

  // The snapshot drops drift-b: its terms are subtracted from a count that no longer covers them.
  await expect(
    persistSessionSnapshot({
      sessionId,
      piSessionId: PI_SESSION_ID,
      activeNodeId: reply.id,
      nodes: [first, reply],
    }),
  ).resolves.toBeUndefined()

  const indexState = await readIndexState(sessionId)
  expect(indexState?.nodes).toBe(2)
  // Rebuilt exactly: the document count agrees with its inverted index again.
  expect(indexState?.token_count).toBe(indexState?.occurrences)
  expect(indexState?.token_count).toBe(7)
})

it('persists a turn that changes an existing node under a drifted term index', async () => {
  const { sessionId, first, second } = await seedSessionWithDriftedIndex()
  const edited = { ...second, contentJson: JSON.stringify({ text: 'omega' }) }

  await expect(
    persistSessionSnapshot({
      sessionId,
      piSessionId: PI_SESSION_ID,
      activeNodeId: edited.id,
      nodes: [first, edited],
    }),
  ).resolves.toBeUndefined()

  const indexState = await readIndexState(sessionId)
  expect(indexState?.nodes).toBe(2)
  expect(indexState?.token_count).toBe(indexState?.occurrences)
})

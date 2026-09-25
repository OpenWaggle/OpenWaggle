import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import * as SqlClient from '@effect/sql/SqlClient'
import { SessionId } from '@shared/types/brand'
import * as Effect from 'effect/Effect'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createSession, persistSessionSnapshot } from '../session-details'
import {
  repairStaleTranscriptTermProjections,
  resetTranscriptTermRepairBackoff,
} from '../session-details/snapshot-transcript-term-projection'
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
  resetTranscriptTermRepairBackoff()
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

function repairStale(limit?: number) {
  return runStoreEffect(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      return yield* repairStaleTranscriptTermProjections(sql, limit === undefined ? {} : { limit })
    }),
  )
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

  // The turn committed; the derived index was marked stale instead of failing it.
  const stale = await readIndexState(sessionId)
  expect(stale?.nodes).toBe(2)
  expect(stale?.token_count).toBeNull()

  // Repaired afterwards, outside the turn's transaction, and exact.
  expect(await repairStale()).toEqual({ selected: 1, repaired: 1 })
  const repaired = await readIndexState(sessionId)
  expect(repaired?.token_count).toBe(repaired?.occurrences)
  expect(repaired?.token_count).toBe(7)
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

  expect((await readIndexState(sessionId))?.nodes).toBe(2)
  await repairStale()
  const indexState = await readIndexState(sessionId)
  expect(indexState?.token_count).toBe(indexState?.occurrences)
})

it('repairs a bounded number of stale Sessions per pass and never selects deleted ones', async () => {
  const drifted = await seedSessionWithDriftedIndex()
  const other = await createSession({ projectPath: '/tmp/term-drift-2', piSessionId: 'pi-2' })
  const otherId = SessionId(String(other.id))
  const node = transcriptNode('other-a', null, 0, 'other words', 'run-o')
  await persistSessionSnapshot({
    sessionId: otherId,
    piSessionId: 'pi-2',
    activeNodeId: node.id,
    nodes: [node],
  })
  // Both Sessions lose their index (the durable stale marker), then one is deleted.
  await runStoreEffect(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      yield* sql`DELETE FROM session_transcript_term_documents`
      yield* sql`DELETE FROM sessions WHERE id = ${otherId}`
    }),
  )

  expect(await repairStale(1)).toEqual({ selected: 1, repaired: 1 })
  expect(await repairStale(1)).toEqual({ selected: 0, repaired: 0 })
  const repaired = await readIndexState(drifted.sessionId)
  expect(repaired?.token_count).toBe(repaired?.occurrences)
})

it('keeps a Session stale across later snapshots until the exact repair runs', async () => {
  const { sessionId, first, second } = await seedSessionWithDriftedIndex()
  // Stale: nodes but no term document (a failed projection, or a repair that has not run yet).
  await runStoreEffect(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      // markStale removes only the document row; the retained terms are unreachable until repair.
      yield* sql`DELETE FROM session_transcript_term_documents WHERE session_id = ${sessionId}`
    }),
  )
  const third = transcriptNode('drift-c', 'drift-b', 2, 'gamma extra', 'run-c')

  await persistSessionSnapshot({
    sessionId,
    piSessionId: PI_SESSION_ID,
    activeNodeId: third.id,
    nodes: [first, second, third],
  })

  // Review finding: the incremental delta rebuilt a partial index for only the new node, and the
  // Session was never selected for repair again.
  expect((await readIndexState(sessionId))?.token_count).toBeNull()
  expect(await repairStale()).toEqual({ selected: 1, repaired: 1 })
  const repaired = await readIndexState(sessionId)
  expect(repaired?.token_count).toBe(10)
  expect(repaired?.token_count).toBe(repaired?.occurrences)
})

it('never loses a turn when reading the derived index state fails', async () => {
  const { sessionId, first, second } = await seedSessionWithDriftedIndex()
  await runStoreEffect(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      // Review finding: an uncaught derived read rolled back the snapshot and lost the turn.
      yield* sql.unsafe('ALTER TABLE session_transcript_term_documents RENAME TO documents_moved')
    }),
  )
  const third = transcriptNode('drift-c', 'drift-b', 2, 'gamma extra', 'run-c')

  await expect(
    persistSessionSnapshot({
      sessionId,
      piSessionId: PI_SESSION_ID,
      activeNodeId: third.id,
      nodes: [first, second, third],
    }),
  ).resolves.toBeUndefined()

  const nodes = await runStoreEffect(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      yield* sql.unsafe('ALTER TABLE documents_moved RENAME TO session_transcript_term_documents')
      return yield* sql<{ readonly count: number }>`
        SELECT COUNT(*) AS count FROM session_nodes WHERE session_id = ${sessionId}
      `
    }),
  )
  expect(nodes[0]?.count).toBe(3)
})

it('backs a failing repair off from the time it failed, then retries it', async () => {
  const { sessionId } = await seedSessionWithDriftedIndex()
  await runStoreEffect(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      yield* sql`DELETE FROM session_transcript_term_documents WHERE session_id = ${sessionId}`
      yield* sql.unsafe(`CREATE TRIGGER fail_repair BEFORE INSERT ON session_transcript_term_documents
        BEGIN SELECT RAISE(ABORT, 'repair blocked'); END`)
    }),
  )
  const repairAt = (now: number) =>
    runStoreEffect(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        return yield* repairStaleTranscriptTermProjections(sql, { now })
      }),
    )

  expect(await repairAt(1_000)).toEqual({ selected: 1, repaired: 0 })
  // Inside the first backoff window the Session is not selected again.
  expect(await repairAt(2_000)).toEqual({ selected: 0, repaired: 0 })
  await runStoreEffect(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      yield* sql.unsafe('DROP TRIGGER fail_repair')
    }),
  )
  expect(await repairAt(1_000 + 60_000)).toEqual({ selected: 1, repaired: 1 })
})

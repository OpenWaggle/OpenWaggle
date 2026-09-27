import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import * as SqlClient from '@effect/sql/SqlClient'
import { SessionId } from '@shared/types/brand'
import * as Effect from 'effect/Effect'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { appendDurableAgentLoopEvents } from '../../application/agent-run/agent-loop-events'
import type { ProjectedSessionNodeInput } from '../../ports/session-repository'
import { createSession, persistSessionSnapshot } from '../session-details'
import { getSessionTree } from '../sessions'
import { runStoreEffect } from '../store-runtime'
import { transcriptNode } from './session-snapshot-semantic-retention.test-support'

/**
 * Durable agent-loop nodes are not Pi entries: every snapshot renumbers them after the Pi
 * entries. A turn that adds fewer Pi entries than the Session has agent-loop nodes shifts each
 * one onto a slot another still holds, and SQLite checks `UNIQUE (session_id, created_order)` per
 * row. Reproduced in the alpha: "This response couldn't be saved", `SQLITE_CONSTRAINT_UNIQUE`.
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

const PI_SESSION_ID = 'pi-created-order-shift'

beforeEach(async () => {
  state.userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ow-created-order-'))
  const { resetAppRuntimeForTests } = await import('../../runtime')
  await resetAppRuntimeForTests()
})

afterEach(async () => {
  const temporaryRoot = state.userDataDir
  const { resetAppRuntimeForTests } = await import('../../runtime')
  await resetAppRuntimeForTests()
  await fs.rm(temporaryRoot, { recursive: true, force: true })
})

/** Pi entries are projected with `createdOrder` equal to their index in the Pi session. */
function piEntries(count: number) {
  return Array.from({ length: count }, (_, index) => {
    const node = transcriptNode(
      `pi-${String(index)}`,
      index === 0 ? null : `pi-${String(index - 1)}`,
      index,
      '',
      `run-${String(index)}`,
    )
    return {
      ...node,
      contentJson: JSON.stringify({ parts: [{ type: 'text', text: `message ${String(index)}` }] }),
    }
  })
}

async function persistRun(
  sessionId: SessionId,
  pi: readonly ProjectedSessionNodeInput[],
  runId: string,
) {
  const tree = await getSessionTree(sessionId)
  const snapshot = appendDurableAgentLoopEvents({
    snapshot: { nodes: pi, activeNodeId: pi.at(-1)?.id ?? null },
    events: [{ type: 'custom', name: 'openwaggle.test', timestamp: pi.length, value: runId }],
    runId,
    existingNodes: tree?.nodes ?? [],
  })
  await persistSessionSnapshot({
    sessionId,
    piSessionId: PI_SESSION_ID,
    activeNodeId: snapshot.activeNodeId,
    nodes: snapshot.nodes,
  })
}

function readOrders(sessionId: SessionId) {
  return runStoreEffect(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      return yield* sql<{ readonly id: string; readonly created_order: number }>`
        SELECT id, created_order FROM session_nodes
        WHERE session_id = ${sessionId} ORDER BY created_order
      `
    }),
  )
}

function readTermIndexConsistency(sessionId: SessionId) {
  return runStoreEffect(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const rows = yield* sql<{ readonly documents: number; readonly consistent: number }>`
        SELECT COUNT(*) AS documents,
          COALESCE(SUM(documents.token_count = (
            SELECT COALESCE(SUM(terms.occurrences), 0) FROM session_transcript_terms AS terms
            WHERE terms.session_id = documents.session_id
          )), 0) AS consistent
        FROM session_transcript_term_documents AS documents
        WHERE documents.session_id = ${sessionId}
      `
      return rows[0]
    }),
  )
}

it('saves a turn that adds fewer Pi entries than the Session has agent-loop nodes', async () => {
  const session = await createSession({
    projectPath: '/tmp/created-order',
    piSessionId: PI_SESSION_ID,
  })
  const sessionId = SessionId(String(session.id))

  // Four runs that each add several Pi entries and one agent-loop event: agent-loop nodes pile
  // up after the Pi entries, as in a Hive Worker driven by follow-ups.
  for (const [run, count] of [8, 16, 24, 32].entries()) {
    await persistRun(sessionId, piEntries(count), `run-${String(run)}`)
  }
  const before = await readOrders(sessionId)
  expect(
    before.filter((row) => row.id.includes(':agent-loop:')).map((row) => row.created_order),
  ).toEqual([32, 33, 34, 35])

  // A short reply adds two Pi entries, fewer than the four agent-loop nodes that must move.
  await persistRun(sessionId, piEntries(34), 'run-short')

  const after = await readOrders(sessionId)
  expect(after).toHaveLength(34 + 5)
  expect(after.map((row) => row.created_order)).toEqual(
    Array.from({ length: 39 }, (_, index) => index),
  )
  expect(after.slice(0, 34).every((row) => row.id.startsWith('pi-'))).toBe(true)
  // The derived term index followed the move instead of being marked stale for repair.
  expect(await readTermIndexConsistency(sessionId)).toEqual({ documents: 1, consistent: 1 })
})

it('saves a snapshot that moves a node into the slot of a node it removes', async () => {
  const session = await createSession({
    projectPath: '/tmp/created-order-removed',
    piSessionId: PI_SESSION_ID,
  })
  const sessionId = SessionId(String(session.id))
  const [first, second, third] = piEntries(3)
  if (!first || !second || !third) throw new Error('expected three Pi entries')
  await persistSessionSnapshot({
    sessionId,
    piSessionId: PI_SESSION_ID,
    activeNodeId: third.id,
    nodes: [first, second, third],
  })

  // The removed node is deleted only after the others are rewritten, so its slot is still taken.
  const moved = { ...third, parentId: first.id, pathDepth: 1, createdOrder: 1 }
  await persistSessionSnapshot({
    sessionId,
    piSessionId: PI_SESSION_ID,
    activeNodeId: moved.id,
    nodes: [first, moved],
  })

  expect(await readOrders(sessionId)).toEqual([
    { id: first.id, created_order: 0 },
    { id: third.id, created_order: 1 },
  ])
})

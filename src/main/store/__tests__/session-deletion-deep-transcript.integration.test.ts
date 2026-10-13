import { execFile } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import * as SqlClient from '@effect/sql/SqlClient'
import type { SessionId } from '@shared/types/brand'
import * as Effect from 'effect/Effect'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  commitSessionDeletion,
  createSession,
  getSessionDetail,
  prepareSessionDeletion,
} from '../session-details'
import { runStoreEffect } from '../store-runtime'

const state = vi.hoisted(() => ({ userDataDir: '' }))

vi.mock('electron', () => ({
  app: { getPath: () => state.userDataDir },
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: (value: string) => Buffer.from(value, 'utf8'),
    decryptString: (value: Buffer) => value.toString('utf8'),
  },
}))

/** SQLite runs each cascading delete as a trigger and stops past 1000 nested ones. */
const DEEPER_THAN_SQLITE_TRIGGER_DEPTH = 1_500

/** One linear branch: each node's parent is the one before it, as a long Pi transcript stores. */
async function sessionWithLinearTranscript(depth: number) {
  const session = await createSession({ projectPath: state.userDataDir, piSessionId: 'deep' })
  await runStoreEffect(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      yield* sql.withTransaction(
        Effect.forEach(
          Array.from({ length: depth }, (_, index) => index),
          (index) => sql`
            INSERT INTO session_nodes (
              id, session_id, parent_id, pi_entry_type, kind, role, timestamp_ms,
              content_json, metadata_json, path_depth, created_order
            ) VALUES (
              ${`node-${String(index)}`}, ${session.id},
              ${index === 0 ? null : `node-${String(index - 1)}`},
              ${'message'}, ${'message'}, ${'user'}, ${index},
              ${'{"parts":[{"type":"text","text":"turn"}]}'}, ${'{}'}, ${index}, ${index}
            )
          `,
          { discard: true },
        ),
      )
    }),
  )
  return session
}

async function remainingNodes(id: SessionId) {
  return runStoreEffect(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const rows = yield* sql<{ readonly nodes: number }>`
        SELECT COUNT(*) AS nodes FROM session_nodes WHERE session_id = ${id}
      `
      return rows[0]?.nodes
    }),
  )
}

async function childLookupPlan() {
  return runStoreEffect(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const rows = yield* sql<{ readonly detail: string }>`
        EXPLAIN QUERY PLAN SELECT 1 FROM session_nodes WHERE parent_id = ${'node-0'}
      `
      return rows.map((row) => row.detail).join(' ')
    }),
  )
}

beforeEach(async () => {
  state.userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ow-session-deep-delete-'))
  const { resetAppRuntimeForTests } = await import('../../runtime')
  await resetAppRuntimeForTests()
  await promisify(execFile)('git', ['init', state.userDataDir])
})

afterEach(async () => {
  const { resetAppRuntimeForTests } = await import('../../runtime')
  await resetAppRuntimeForTests()
  await fs.rm(state.userDataDir, { recursive: true, force: true })
})

describe('Session deletion of a deep transcript', () => {
  it('deletes a Session whose transcript is deeper than SQLite cascades can recurse', async () => {
    const session = await sessionWithLinearTranscript(DEEPER_THAN_SQLITE_TRIGGER_DEPTH)

    await expect(prepareSessionDeletion(session.id)).resolves.toMatchObject({ phase: 'prepared' })
    await expect(commitSessionDeletion(session.id)).resolves.toMatchObject({
      phase: 'durable-delete-complete',
    })

    await expect(getSessionDetail(session.id)).resolves.toBeNull()
    await expect(remainingNodes(session.id)).resolves.toBe(0)
  })

  it('finds a node’s children through an index, not a scan of every transcript', async () => {
    // Every node delete cascades to its children; without an index each one scans the table.
    await sessionWithLinearTranscript(2)

    await expect(childLookupPlan()).resolves.toMatch(/USING (COVERING )?INDEX/u)
  })
})

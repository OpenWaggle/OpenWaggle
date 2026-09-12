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

async function populatedSession() {
  const session = await createSession({
    projectPath: state.userDataDir,
    piSessionId: 'search-cleanup',
  })
  await runStoreEffect(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      yield* sql`
        INSERT INTO session_nodes (
          id, session_id, pi_entry_type, kind, role, timestamp_ms,
          content_json, metadata_json, path_depth, created_order
        ) VALUES (
          ${'search-node'}, ${session.id}, ${'message'}, ${'message'}, ${'user'}, ${1},
          ${'{"parts":[{"type":"text","text":"Search cleanup marker"}]}'}, ${'{}'}, ${0}, ${0}
        )
      `
    }),
  )
  return session
}

async function searchState(id: SessionId) {
  return runStoreEffect(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const counts = yield* sql`
        SELECT
          (SELECT COUNT(*) FROM session_nodes WHERE session_id = ${id}) AS nodes,
          (SELECT COUNT(*) FROM session_node_search WHERE session_id = ${id}) AS transcript,
          (SELECT COUNT(*) FROM session_node_discovery_search WHERE session_id = ${id}) AS discovery,
          (SELECT COUNT(*) FROM session_discovery_embedding_queue WHERE session_id = ${id}) AS queued
      `
      const foreignKeyErrors = yield* sql.unsafe('PRAGMA foreign_key_check')
      return { counts, foreignKeyErrors }
    }),
  )
}

beforeEach(async () => {
  state.userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ow-session-search-delete-'))
  const { resetAppRuntimeForTests } = await import('../../runtime')
  await resetAppRuntimeForTests()
  await promisify(execFile)('git', ['init', state.userDataDir])
})

afterEach(async () => {
  const { resetAppRuntimeForTests } = await import('../../runtime')
  await resetAppRuntimeForTests()
  await fs.rm(state.userDataDir, { recursive: true, force: true })
})

describe('Session deletion search cleanup', () => {
  it('preflights and commits deletion of a populated Session without recreating orphan work', async () => {
    const session = await populatedSession()
    const before = await searchState(session.id)
    expect(before.counts).toEqual([{ nodes: 1, transcript: 1, discovery: 1, queued: 1 }])

    await expect(prepareSessionDeletion(session.id)).resolves.toMatchObject({ phase: 'prepared' })
    await expect(searchState(session.id)).resolves.toEqual(before)
    await expect(commitSessionDeletion(session.id)).resolves.toMatchObject({
      phase: 'durable-delete-complete',
    })

    await expect(getSessionDetail(session.id)).resolves.toBeNull()
    await expect(searchState(session.id)).resolves.toEqual({
      counts: [{ nodes: 0, transcript: 0, discovery: 0, queued: 0 }],
      foreignKeyErrors: [],
    })
  })

  it('still queues semantic refresh when only a node is deleted from a surviving Session', async () => {
    const session = await populatedSession()
    await runStoreEffect(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* sql`DELETE FROM session_discovery_embedding_queue WHERE session_id = ${session.id}`
        yield* sql`DELETE FROM session_nodes WHERE id = ${'search-node'}`
      }),
    )

    await expect(getSessionDetail(session.id)).resolves.not.toBeNull()
    await expect(searchState(session.id)).resolves.toEqual({
      counts: [{ nodes: 0, transcript: 0, discovery: 1, queued: 1 }],
      foreignKeyErrors: [],
    })
  })
})

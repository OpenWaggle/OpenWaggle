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
import { continuesImmediately, firstKeys } from '../session-details/transcript-term-repair-policy'
import { runStoreEffect } from '../store-runtime'
import { transcriptNode } from './session-snapshot-semantic-retention.test-support'

/** ADR 0037: the background repair of stale transcript-term indexes stays bounded under failure. */

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
  resetTranscriptTermRepairBackoff()
  state.userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ow-term-repair-'))
  const { resetAppRuntimeForTests } = await import('../../runtime')
  await resetAppRuntimeForTests()
})

afterEach(async () => {
  const temporaryRoot = state.userDataDir
  const { resetAppRuntimeForTests } = await import('../../runtime')
  await resetAppRuntimeForTests()
  await fs.rm(temporaryRoot, { recursive: true, force: true })
})

it('backs a failing repair off from the time it failed, then retries it', async () => {
  const session = await createSession({
    projectPath: '/tmp/term-backoff',
    piSessionId: 'pi-backoff',
  })
  const sessionId = SessionId(String(session.id))
  const node = transcriptNode('backoff-a', null, 0, 'alpha beta gamma', 'run-a')
  await persistSessionSnapshot({
    sessionId,
    piSessionId: 'pi-backoff',
    activeNodeId: node.id,
    nodes: [node],
  })
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

it('bounds each repair pass while many stale Sessions keep failing', async () => {
  const ids: SessionId[] = []
  for (let index = 0; index < 20; index += 1) {
    const session = await createSession({
      projectPath: `/tmp/term-bulk-${String(index)}`,
      piSessionId: `pi-b${String(index)}`,
    })
    const id = SessionId(String(session.id))
    const node = transcriptNode(`bulk-${String(index)}`, null, 0, 'bulk words here', 'run-b')
    await persistSessionSnapshot({
      sessionId: id,
      piSessionId: `pi-b${String(index)}`,
      activeNodeId: node.id,
      nodes: [node],
    })
    ids.push(id)
  }
  await runStoreEffect(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      yield* sql`DELETE FROM session_transcript_term_documents`
      yield* sql.unsafe(`CREATE TRIGGER fail_bulk_repair BEFORE INSERT ON session_transcript_term_documents
        BEGIN SELECT RAISE(ABORT, 'repair blocked'); END`)
    }),
  )
  const repairAt = (now: number) =>
    runStoreEffect(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        return yield* repairStaleTranscriptTermProjections(sql, { now, limit: 4 })
      }),
    )

  // Every pass attempts at most one batch, and the cursor moves on past failed Sessions.
  const passes = [await repairAt(1_000), await repairAt(1_000), await repairAt(1_000)]
  expect(passes.map((pass) => pass.selected)).toEqual([4, 4, 4])
  expect(passes.every((pass) => pass.repaired === 0)).toBe(true)
  await runStoreEffect(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      yield* sql.unsafe('DROP TRIGGER fail_bulk_repair')
    }),
  )
  let repaired = 0
  for (let pass = 0; pass < 10; pass += 1) repaired += (await repairAt(1_000 + 60_000)).repaired
  expect(repaired).toBe(ids.length)
})

it('waits after a failed batch and inspects a bounded slice of backoff per pass', () => {
  // The loop continues at once only after full progress, so persistent failures cannot spin it.
  expect(continuesImmediately({ repaired: 4 })).toBe(true)
  expect(continuesImmediately({ repaired: 0 })).toBe(false)
  expect(continuesImmediately({ repaired: 3 })).toBe(false)
  const backoff = new Map(
    Array.from({ length: 1_000 }, (_, index) => [`s-${String(index)}`, index]),
  )
  expect(firstKeys(backoff, 16)).toEqual(
    Array.from({ length: 16 }, (_, index) => `s-${String(index)}`),
  )
})

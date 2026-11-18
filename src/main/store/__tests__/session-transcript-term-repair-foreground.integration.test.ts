import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import * as SqlClient from '@effect/sql/SqlClient'
import { SessionId } from '@shared/types/brand'
import * as Effect from 'effect/Effect'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import {
  HOST_BACKGROUND_MAX_DEFERRAL_MS,
  hostBackgroundGate,
} from '../../application/host-background-gate'
import { createSession, persistSessionSnapshot } from '../session-details'
import {
  repairStaleTranscriptTermProjections,
  resetTranscriptTermRepairBackoff,
} from '../session-details/snapshot-transcript-term-projection'
import { runStoreEffect } from '../store-runtime'
import { transcriptNode } from './session-snapshot-semantic-retention.test-support'

/**
 * W12: the background term repair gives way to client commands. It ran slice after slice between
 * the statements of the desktop's requests, so opening a large Session in another project took
 * 0.7-1.6 s while it ran instead of ~250 ms.
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

/** Long enough for an unpaused repair of two small Sessions to finish many times over. */
const PAUSE_OBSERVATION_MS = 200

beforeEach(async () => {
  resetTranscriptTermRepairBackoff()
  state.userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ow-term-foreground-'))
  const { resetAppRuntimeForTests } = await import('../../runtime')
  await resetAppRuntimeForTests()
})

afterEach(async () => {
  const temporaryRoot = state.userDataDir
  const { resetAppRuntimeForTests } = await import('../../runtime')
  await resetAppRuntimeForTests()
  await fs.rm(temporaryRoot, { recursive: true, force: true })
})

async function seedStaleSession(label: string) {
  const session = await createSession({ projectPath: `/tmp/${label}`, piSessionId: `pi-${label}` })
  const sessionId = SessionId(String(session.id))
  const nodes = Array.from({ length: 6 }, (_, index) =>
    transcriptNode(
      `${label}-${String(index)}`,
      index === 0 ? null : `${label}-${String(index - 1)}`,
      index,
      `${label} words number${String(index)}`,
      'run-1',
    ),
  )
  await persistSessionSnapshot({
    sessionId,
    piSessionId: `pi-${label}`,
    activeNodeId: nodes.at(-1)?.id ?? null,
    nodes,
  })
  await withSql(
    (sql) => sql`DELETE FROM session_transcript_term_documents WHERE session_id = ${sessionId}`,
  )
  return sessionId
}

function withSql<A>(body: (sql: SqlClient.SqlClient) => Effect.Effect<A, unknown>) {
  return runStoreEffect(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      return yield* body(sql)
    }),
  )
}

async function documentedSessions(sessionIds: readonly string[]) {
  const rows = await withSql(
    (sql) => sql<{ readonly session_id: string }>`
      SELECT session_id FROM session_transcript_term_documents
      WHERE session_id IN (SELECT CAST(value AS TEXT) FROM json_each(${JSON.stringify(sessionIds)}))
    `,
  )
  return rows.length
}

it('waits while a client command is in flight and resumes once the clients are quiet', async () => {
  const sessionIds = [await seedStaleSession('first'), await seedStaleSession('second')]
  hostBackgroundGate.enable()
  const endCommand = hostBackgroundGate.foregroundStarted()

  let finished = false
  const repair = withSql((sql) => repairStaleTranscriptTermProjections(sql)).then((result) => {
    finished = true
    return result
  })
  await new Promise((resolve) => setTimeout(resolve, PAUSE_OBSERVATION_MS))
  expect(finished).toBe(false)
  expect(await documentedSessions(sessionIds)).toBe(0)

  const endedAt = performance.now()
  endCommand()
  expect(await repair).toEqual({ selected: 2, repaired: 2 })
  // Resumed by the quiet moment, not by the maximum deferral.
  expect(performance.now() - endedAt).toBeLessThan(HOST_BACKGROUND_MAX_DEFERRAL_MS)
  expect(await documentedSessions(sessionIds)).toBe(2)
})

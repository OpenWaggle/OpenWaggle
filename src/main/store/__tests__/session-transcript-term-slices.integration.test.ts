import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import * as SqlClient from '@effect/sql/SqlClient'
import { SessionId } from '@shared/types/brand'
import * as Effect from 'effect/Effect'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { refreshSessionTranscriptTerms } from '../../services/session-transcript-term-projection'
import { rebuildSessionTranscriptTermsInSlices } from '../../services/session-transcript-term-sliced-rebuild'
import { createSession, persistSessionSnapshot } from '../session-details'
import {
  repairStaleTranscriptTermProjections,
  resetTranscriptTermRepairBackoff,
} from '../session-details/snapshot-transcript-term-projection'
import { runStoreEffect } from '../store-runtime'
import {
  readTermProjection,
  transcriptNode,
} from './session-snapshot-semantic-retention.test-support'

/** ADR 0037: a stale Session's term index is rebuilt in short slices, never in one long hold. */

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
  state.userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ow-term-slices-'))
  const { resetAppRuntimeForTests } = await import('../../runtime')
  await resetAppRuntimeForTests()
})

afterEach(async () => {
  const temporaryRoot = state.userDataDir
  const { resetAppRuntimeForTests } = await import('../../runtime')
  await resetAppRuntimeForTests()
  await fs.rm(temporaryRoot, { recursive: true, force: true })
})

const NODE_COUNT = 23
const WORDS = ['alpha', 'beta', 'gamma', 'delta', 'epsilon', 'zeta', 'eta']

function nodeText(index: number) {
  // Overlapping vocabularies, so a term's count and first evidence span several slices.
  return `${WORDS[index % WORDS.length]} ${WORDS[(index * 3) % WORDS.length]} marker${index % 5}`
}

function seedNodes(label: string) {
  return Array.from({ length: NODE_COUNT }, (_, index) =>
    transcriptNode(
      `${label}-${String(index)}`,
      index === 0 ? null : `${label}-${String(index - 1)}`,
      index,
      nodeText(index),
      `run-${String(Math.floor(index / 4))}`,
    ),
  )
}

async function seedSession(label: string) {
  const session = await createSession({ projectPath: `/tmp/${label}`, piSessionId: `pi-${label}` })
  const sessionId = SessionId(String(session.id))
  const nodes = seedNodes(label)
  await persistSessionSnapshot({
    sessionId,
    piSessionId: `pi-${label}`,
    activeNodeId: nodes.at(-1)?.id ?? null,
    nodes,
  })
  await runStoreEffect(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      yield* sql`
        INSERT OR IGNORE INTO session_control_states (
          session_id, state_revision, queue_state, queue_revision, node_mutation_revision,
          updated_at
        ) VALUES (${sessionId}, 0, 'running', 0, 0, 0)
      `
    }),
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

function documentRow(sessionId: string) {
  return withSql(
    (sql) =>
      sql<{ readonly token_count: number }>`
      SELECT token_count FROM session_transcript_term_documents WHERE session_id = ${sessionId}
    `,
  )
}

it('builds the same index in slices as in one transaction, yielding between slices', async () => {
  const sessionId = await seedSession('slices')
  await withSql((sql) => refreshSessionTranscriptTerms(sql, [sessionId]))
  const expected = await readTermProjection(sessionId)
  const expectedDocument = await documentRow(sessionId)

  let yields = 0
  await withSql((sql) =>
    Effect.gen(function* () {
      yield* sql`DELETE FROM session_transcript_terms WHERE session_id = ${sessionId}`
      yield* sql`DELETE FROM session_transcript_term_documents WHERE session_id = ${sessionId}`
      yield* rebuildSessionTranscriptTermsInSlices(sql, sessionId, {
        sliceNodes: 5,
        betweenSlices: Effect.sync(() => {
          yields += 1
        }),
      })
    }),
  )

  // 23 nodes in slices of 5: four full slices, and the fifth publishes.
  expect(yields).toBe(4)
  expect(await readTermProjection(sessionId)).toEqual(expected)
  expect(await documentRow(sessionId)).toEqual(expectedDocument)
})

it('replaces a large term set in bounded chunks and publishes the document last', async () => {
  const sessionId = await seedSession('chunks')
  await withSql((sql) => refreshSessionTranscriptTerms(sql, [sessionId]))
  const expected = await readTermProjection(sessionId)
  const documentsSeen: number[] = []
  await withSql((sql) =>
    Effect.gen(function* () {
      // Stale, with its old rows still present, as `markStale` leaves a Session.
      yield* sql`DELETE FROM session_transcript_term_documents WHERE session_id = ${sessionId}`
      yield* rebuildSessionTranscriptTermsInSlices(sql, sessionId, {
        sliceNodes: 100,
        publishChunk: 3,
        betweenSlices: Effect.gen(function* () {
          const rows = yield* sql<{ readonly count: number }>`
            SELECT COUNT(*) AS count FROM session_transcript_term_documents
          `.pipe(Effect.orDie)
          documentsSeen.push(rows[0]?.count ?? -1)
        }),
      })
    }),
  )
  // Many bounded steps, none of which exposed a document before the last.
  expect(documentsSeen.length).toBeGreaterThan(4)
  expect(new Set(documentsSeen)).toEqual(new Set([0]))
  expect(await readTermProjection(sessionId)).toEqual(expected)
})

it('keeps the Session stale until the last slice publishes', async () => {
  const sessionId = await seedSession('partial')
  await withSql((sql) => sql`DELETE FROM session_transcript_term_documents`)
  const documentsSeenBetweenSlices: number[] = []
  await withSql((sql) =>
    rebuildSessionTranscriptTermsInSlices(sql, sessionId, {
      sliceNodes: 5,
      betweenSlices: Effect.gen(function* () {
        const rows = yield* sql<{ readonly count: number }>`
          SELECT COUNT(*) AS count FROM session_transcript_term_documents
        `.pipe(Effect.orDie)
        documentsSeenBetweenSlices.push(rows[0]?.count ?? -1)
      }),
    }),
  )
  expect(documentsSeenBetweenSlices).toEqual([0, 0, 0, 0])
  expect((await documentRow(sessionId)).length).toBe(1)
})

it('starts over when a node is edited between slices, and picks up appended nodes', async () => {
  const sessionId = await seedSession('edits')
  let step = 0
  await withSql((sql) =>
    Effect.gen(function* () {
      yield* sql`DELETE FROM session_transcript_term_documents WHERE session_id = ${sessionId}`
      yield* rebuildSessionTranscriptTermsInSlices(sql, sessionId, {
        sliceNodes: 5,
        betweenSlices: Effect.gen(function* () {
          step += 1
          if (step === 1) {
            // An edit to an already counted node: the node-mutation trigger bumps the revision.
            yield* sql`
              UPDATE session_nodes SET content_json = ${JSON.stringify({ text: 'rewritten omega' })}
              WHERE id = ${'edits-0'}
            `.pipe(Effect.orDie)
          }
          if (step === 2) {
            yield* sql`
              INSERT INTO session_nodes (
                id, session_id, parent_id, pi_entry_type, kind, role, timestamp_ms,
                content_json, metadata_json, path_depth, created_order
              ) VALUES (
                ${'edits-appended'}, ${sessionId}, ${'edits-22'}, 'message', 'assistant_message',
                'assistant', 100, ${JSON.stringify({ text: 'appended sigma' })}, '{}', 23, 100
              )
            `.pipe(Effect.orDie)
          }
        }),
      })
    }),
  )
  const sliced = await readTermProjection(sessionId)
  await withSql((sql) => refreshSessionTranscriptTerms(sql, [sessionId]))
  expect(sliced).toEqual(await readTermProjection(sessionId))
  const terms = sliced.terms.map((row) => row.term)
  expect(terms).toContain('omega')
  expect(terms).toContain('sigma')
})

it('counts a node a snapshot appends while the rebuild publishes its terms', async () => {
  const sessionId = await seedSession('publish-append')
  const nodes = seedNodes('publish-append')
  const appended = transcriptNode(
    'publish-append-new',
    'publish-append-22',
    NODE_COUNT,
    'appendedomega',
    'run-late',
  )
  let step = 0
  let appendedAtStep = 0
  await withSql((sql) =>
    Effect.gen(function* () {
      // Stale with its old rows present, so the appending snapshot skips its incremental delta.
      yield* sql`DELETE FROM session_transcript_term_documents WHERE session_id = ${sessionId}`
      yield* rebuildSessionTranscriptTermsInSlices(sql, sessionId, {
        // One accumulate step, then many publish steps.
        sliceNodes: 100,
        publishChunk: 2,
        betweenSlices: Effect.gen(function* () {
          step += 1
          if (step !== 3) return
          appendedAtStep = step
          yield* Effect.promise(() =>
            persistSessionSnapshot({
              sessionId,
              piSessionId: 'pi-publish-append',
              activeNodeId: appended.id,
              nodes: [...nodes, appended],
            }),
          )
        }),
      })
    }),
  )
  expect(appendedAtStep).toBe(3)
  const sliced = await readTermProjection(sessionId)
  expect(sliced.terms.map((row) => row.term)).toContain('appendedomega')
  await withSql((sql) => refreshSessionTranscriptTerms(sql, [sessionId]))
  expect(sliced).toEqual(await readTermProjection(sessionId))
})

it('repairs every stale Session while giving the event loop a turn between them', async () => {
  const first = await seedSession('repair-a')
  const second = await seedSession('repair-b')
  await withSql((sql) => sql`DELETE FROM session_transcript_term_documents`)
  let timerRuns = 0
  const timer = setInterval(() => {
    timerRuns += 1
  }, 0)
  try {
    const result = await withSql((sql) => repairStaleTranscriptTermProjections(sql))
    expect(result).toEqual({ selected: 2, repaired: 2 })
  } finally {
    clearInterval(timer)
  }
  expect(timerRuns).toBeGreaterThan(0)
  expect((await documentRow(first)).length).toBe(1)
  expect((await documentRow(second)).length).toBe(1)
})

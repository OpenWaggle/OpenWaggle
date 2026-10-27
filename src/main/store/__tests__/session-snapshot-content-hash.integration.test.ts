import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import * as SqlClient from '@effect/sql/SqlClient'
import { SessionId } from '@shared/types/brand'
import * as Effect from 'effect/Effect'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProjectedSessionNodeInput } from '../../ports/session-repository'
import { refreshSessionTranscriptTerms } from '../../services/session-transcript-term-projection'
import { createSession, persistSessionSnapshot } from '../session-details'
import { sessionNodeContentHash } from '../session-details/node-content-hash'
import {
  compareWithStoredNodes,
  loadSnapshotPersistenceState,
} from '../session-details/snapshot-persistence-state'
import { runStoreEffect } from '../store-runtime'
import {
  readTermProjection,
  transcriptNode,
} from './session-snapshot-semantic-retention.test-support'

/**
 * Snapshot persistence compares a Session's stored nodes with a snapshot by the digest stored in
 * `session_nodes.content_hash`, and reads back only the content of nodes whose digest differs
 * (D6). Before this, every Run selected every node's content: 38 MB for the largest Session.
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

const PI_SESSION_ID = 'pi-content-hash'

beforeEach(async () => {
  state.userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ow-content-hash-'))
  const { resetAppRuntimeForTests } = await import('../../runtime')
  await resetAppRuntimeForTests()
})

afterEach(async () => {
  const temporaryRoot = state.userDataDir
  const { resetAppRuntimeForTests } = await import('../../runtime')
  await resetAppRuntimeForTests()
  await fs.rm(temporaryRoot, { recursive: true, force: true })
})

function chain(texts: readonly string[]) {
  return texts.map((text, index) =>
    transcriptNode(
      `n${String(index)}`,
      index === 0 ? null : `n${String(index - 1)}`,
      index,
      text,
      'run-1',
    ),
  )
}

async function newSession() {
  const session = await createSession({
    projectPath: '/tmp/content-hash',
    piSessionId: PI_SESSION_ID,
  })
  return SessionId(String(session.id))
}

function persist(sessionId: SessionId, nodes: readonly ProjectedSessionNodeInput[]) {
  return persistSessionSnapshot({
    sessionId,
    piSessionId: PI_SESSION_ID,
    activeNodeId: nodes.at(-1)?.id ?? null,
    nodes,
  })
}

function withSql<A>(run: (sql: SqlClient.SqlClient) => Effect.Effect<A, unknown>) {
  return runStoreEffect(Effect.flatMap(SqlClient.SqlClient, run))
}

function readNodes(sessionId: SessionId) {
  return withSql(
    (sql) => sql<{
      readonly id: string
      readonly content_json: string
      readonly metadata_json: string
      readonly content_hash: string | null
    }>`
      SELECT id, content_json, metadata_json, content_hash FROM session_nodes
      WHERE session_id = ${sessionId} ORDER BY created_order
    `,
  )
}

/** The stored rows compared with `nodes`, as the next snapshot of them would compare them. */
function compared(sessionId: SessionId, nodes: readonly ProjectedSessionNodeInput[]) {
  return withSql((sql) =>
    Effect.gen(function* () {
      const persistence = yield* loadSnapshotPersistenceState(sql, {
        sessionId,
        piSessionId: PI_SESSION_ID,
        activeNodeId: null,
        nodes,
      })
      return yield* compareWithStoredNodes({
        sql,
        sessionId,
        existingNodes: persistence.existingNodes,
        contentHashByNodeId: new Map(
          nodes.map((node) => [
            node.id,
            sessionNodeContentHash(node.contentJson, node.metadataJson),
          ]),
        ),
      })
    }),
  )
}

function clearHashes(sessionId: SessionId) {
  return withSql(
    (sql) => sql`UPDATE session_nodes SET content_hash = NULL WHERE session_id = ${sessionId}`,
  )
}

async function rebuiltTermProjection(sessionId: SessionId) {
  await withSql((sql) => refreshSessionTranscriptTerms(sql, [sessionId]))
  return readTermProjection(sessionId)
}

describe('snapshot persistence compares nodes by content hash', () => {
  it('stores the digest of each node it writes', async () => {
    const sessionId = await newSession()
    await persist(sessionId, chain(['alpha', 'beta']))

    const rows = await readNodes(sessionId)
    expect(rows.map((row) => row.content_hash)).toEqual(
      rows.map((row) => sessionNodeContentHash(row.content_json, row.metadata_json)),
    )
  })

  it('reads back only the content of nodes whose digest differs', async () => {
    const sessionId = await newSession()
    await persist(sessionId, chain(['alpha', 'beta', 'gamma']))

    const next = chain(['alpha', 'beta changed', 'gamma'])
    const rows = await compared(sessionId, next)
    expect(rows.map((row) => [row.id, row.content !== null])).toEqual([
      ['n0', false],
      ['n1', true],
      ['n2', false],
    ])
  })

  it('never reads the content of nodes the snapshot drops', async () => {
    const sessionId = await newSession()
    await persist(sessionId, chain(['alpha', 'beta']))

    const rows = await compared(sessionId, chain(['alpha']))
    expect(rows.find((row) => row.id === 'n1')?.content).toBeNull()
  })

  it('writes a changed node and keeps the term index exact', async () => {
    const sessionId = await newSession()
    await persist(sessionId, chain(['alpha shared', 'beta', 'gamma']))

    await persist(sessionId, chain(['alpha shared', 'beta shared replacement', 'gamma']))

    const rows = await readNodes(sessionId)
    expect(JSON.parse(rows[1]?.content_json ?? '{}')).toEqual({ text: 'beta shared replacement' })
    expect(rows[1]?.content_hash).toBe(
      sessionNodeContentHash(rows[1]?.content_json ?? '', rows[1]?.metadata_json ?? ''),
    )
    const incremental = await readTermProjection(sessionId)
    expect(incremental.terms.find((term) => term.term === 'shared')?.occurrences).toBe(2)
    expect(incremental).toEqual(await rebuiltTermProjection(sessionId))
  })

  it('compares nodes stored before digests existed by their content, then stores their digest', async () => {
    const sessionId = await newSession()
    await persist(sessionId, chain(['alpha', 'beta', 'gamma']))
    await clearHashes(sessionId)

    // One node changed while the Session had no digests: it is found by its content.
    await persist(sessionId, chain(['alpha', 'beta edited', 'gamma']))

    const rows = await readNodes(sessionId)
    expect(JSON.parse(rows[1]?.content_json ?? '{}')).toEqual({ text: 'beta edited' })
    expect(rows.map((row) => row.content_hash)).toEqual(
      rows.map((row) => sessionNodeContentHash(row.content_json, row.metadata_json)),
    )
    expect(await readTermProjection(sessionId)).toEqual(await rebuiltTermProjection(sessionId))
  })

  it('does not trust a digest another writer left behind when it changed the content', async () => {
    const sessionId = await newSession()
    const nodes = chain(['alpha', 'beta'])
    await persist(sessionId, nodes)
    await withSql(
      (sql) => sql`
        UPDATE session_nodes SET content_json = ${JSON.stringify({ text: 'tampered' })}
        WHERE id = ${'n1'}
      `,
    )

    expect((await readNodes(sessionId))[1]?.content_hash).toBeNull()
    await persist(sessionId, nodes)
    const rows = await readNodes(sessionId)
    expect(JSON.parse(rows[1]?.content_json ?? '{}')).toEqual({ text: 'beta' })
    expect(rows[1]?.content_hash).toBe(
      sessionNodeContentHash(rows[1]?.content_json ?? '', rows[1]?.metadata_json ?? ''),
    )
  })
})

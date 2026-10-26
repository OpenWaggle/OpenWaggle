import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import * as SqlClient from '@effect/sql/SqlClient'
import { SessionId } from '@shared/types/brand'
import * as Effect from 'effect/Effect'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProjectedSessionNodeInput } from '../../ports/session-repository'
import { createSession, persistSessionSnapshot } from '../session-details'
import { runStoreEffect } from '../store-runtime'
import { transcriptNode } from './session-snapshot-semantic-retention.test-support'

/**
 * A Run's snapshot rewrites many nodes in one transaction. Each node used to rebuild the Session's
 * lexical discovery row (initial objective and current preview) and its term postings, about
 * 9 ms per node on a 2 GB database, so a Worker's 268-node snapshot blocked the Host for 2.5 s at
 * Run settlement (#357). The row only depends on the snapshot's final nodes, so it is rebuilt
 * once per snapshot.
 */

const NODE_COUNT = 40

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
  state.userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ow-lexical-discovery-refresh-'))
  const { resetAppRuntimeForTests } = await import('../../runtime')
  await resetAppRuntimeForTests()
})

afterEach(async () => {
  const temporaryRoot = state.userDataDir
  const { resetAppRuntimeForTests } = await import('../../runtime')
  await resetAppRuntimeForTests()
  await fs.rm(temporaryRoot, { recursive: true, force: true })
})

function userNode(id: string, createdOrder: number, text: string): ProjectedSessionNodeInput {
  return {
    ...transcriptNode(id, null, createdOrder, text, 'run-a'),
    kind: 'user_message',
    role: 'user',
  }
}

function conversation(count: number) {
  const nodes: ProjectedSessionNodeInput[] = [userNode('node-0', 0, 'objective alpha')]
  for (let index = 1; index < count; index++) {
    nodes.push(
      transcriptNode(
        `node-${String(index)}`,
        `node-${String(index - 1)}`,
        index,
        `reply ${String(index)} beta`,
        'run-a',
      ),
    )
  }
  return nodes
}

async function createAuditedSession(name: string) {
  const session = await createSession({ projectPath: `/tmp/${name}`, piSessionId: `pi-${name}` })
  await runStoreEffect(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      yield* sql.unsafe('CREATE TABLE discovery_refresh_audit (session_id TEXT NOT NULL)')
      yield* sql.unsafe(`
        CREATE TRIGGER audit_discovery_refresh
        AFTER INSERT ON session_discovery_search_rows BEGIN
          INSERT INTO discovery_refresh_audit (session_id) VALUES (new.session_id);
        END
      `)
    }),
  )
  return SessionId(String(session.id))
}

function discoveryState(sessionId: SessionId) {
  return runStoreEffect(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const [row] = yield* sql<{
        readonly initial_objective: string
        readonly current_preview: string
        readonly refreshes: number
        readonly deferred: number
        readonly matches: number
      }>`
        SELECT rows.initial_objective, rows.current_preview,
          (SELECT COUNT(*) FROM discovery_refresh_audit) AS refreshes,
          (SELECT COUNT(*) FROM session_lexical_discovery_deferrals) AS deferred,
          (SELECT COUNT(*) FROM session_node_discovery_search
            WHERE session_node_discovery_search MATCH 'beta') AS matches
        FROM session_discovery_search_rows AS rows
        WHERE rows.session_id = ${sessionId}
      `
      yield* sql`DELETE FROM discovery_refresh_audit`
      return row
    }),
  )
}

function persist(sessionId: SessionId, name: string, nodes: readonly ProjectedSessionNodeInput[]) {
  return persistSessionSnapshot({
    sessionId,
    piSessionId: `pi-${name}`,
    activeNodeId: nodes.at(-1)?.id ?? null,
    nodes,
  })
}

describe('Session snapshot lexical discovery refresh', () => {
  it('rebuilds the discovery row once when a snapshot inserts many nodes', async () => {
    const sessionId = await createAuditedSession('insert')

    await persist(sessionId, 'insert', conversation(NODE_COUNT))

    expect(await discoveryState(sessionId)).toEqual({
      initial_objective: 'objective alpha',
      current_preview: `reply ${String(NODE_COUNT - 1)} beta`,
      refreshes: 1,
      deferred: 0,
      matches: 1,
    })
  })

  it('rebuilds it once when a snapshot rewrites, moves, and removes nodes', async () => {
    const sessionId = await createAuditedSession('rewrite')
    await persist(sessionId, 'rewrite', conversation(NODE_COUNT))
    await discoveryState(sessionId)

    // Every retained node moves one slot, the last ones go, and the new tail is rewritten.
    const rewritten = conversation(NODE_COUNT / 2).map((node, index) =>
      index === 0
        ? { ...userNode(node.id, 1, 'objective gamma') }
        : {
            ...node,
            createdOrder: index + 1,
            contentJson: JSON.stringify({ text: `edit ${String(index)}` }),
          },
    )
    await persist(sessionId, 'rewrite', rewritten)

    expect(await discoveryState(sessionId)).toEqual({
      initial_objective: 'objective gamma',
      current_preview: `edit ${String(NODE_COUNT / 2 - 1)}`,
      refreshes: 1,
      deferred: 0,
      matches: 0,
    })
  })

  it('still rebuilds it for a node written outside a snapshot', async () => {
    const sessionId = await createAuditedSession('direct')
    await persist(sessionId, 'direct', conversation(2))
    await discoveryState(sessionId)

    await runStoreEffect(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* sql`
          UPDATE session_nodes SET content_json = ${JSON.stringify({ text: 'direct delta' })}
          WHERE id = ${'node-1'}
        `
      }),
    )

    expect(await discoveryState(sessionId)).toMatchObject({
      current_preview: 'direct delta',
      refreshes: 1,
      deferred: 0,
    })
  })

  it('leaves nothing deferred when the snapshot fails', async () => {
    const sessionId = await createAuditedSession('failure')
    await persist(sessionId, 'failure', conversation(2))
    await discoveryState(sessionId)

    // A parent that does not exist fails the insert after the other nodes were written.
    const broken = [...conversation(4), { ...transcriptNode('orphan', 'missing', 9, 'x', 'run-a') }]
    await expect(persist(sessionId, 'failure', broken)).rejects.toThrow()

    expect(await discoveryState(sessionId)).toEqual({
      initial_objective: 'objective alpha',
      current_preview: 'reply 1 beta',
      refreshes: 0,
      deferred: 0,
      matches: 1,
    })
  })
})

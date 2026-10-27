import lifecycleFs from 'node:fs/promises'
import lifecycleOs from 'node:os'
import lifecyclePath from 'node:path'
import * as SqlClient from '@effect/sql/SqlClient'
import { SessionId } from '@shared/types/brand'
import * as Effect from 'effect/Effect'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createSession, persistSessionSnapshot } from '../../session-details'
import { runStoreEffect } from '../../store-runtime'
import { listTurnDiffFiles, recordTurnCheckpoint } from '../../turn-checkpoints'
import { getSessionNodeMutationRevision, searchSessionTreeNodes } from '../session-node-search'

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
  state.userDataDir = await lifecycleFs.mkdtemp(
    lifecyclePath.join(lifecycleOs.tmpdir(), 'ow-session-node-search-'),
  )
  const { resetAppRuntimeForTests } = await import('../../../runtime')
  await resetAppRuntimeForTests()
})

afterEach(async () => {
  const temporaryDirectory = state.userDataDir
  const { resetAppRuntimeForTests } = await import('../../../runtime')
  await resetAppRuntimeForTests()
  await lifecycleFs.rm(temporaryDirectory, { recursive: true, force: true })
})

async function sessionWithTexts(suffix: string, texts: readonly string[]) {
  const session = await createSession({
    projectPath: `/tmp/project-node-search-${suffix}`,
    piSessionId: `pi-node-search-${suffix}`,
    piSessionFile: `/tmp/pi-node-search-${suffix}.jsonl`,
  })
  const sessionId = SessionId(String(session.id))
  await sessionWithTextsAgain(sessionId, suffix, texts)
  return sessionId
}

async function sessionWithTextsAgain(
  sessionId: SessionId,
  suffix: string,
  texts: readonly string[],
) {
  await persistSessionSnapshot({
    sessionId,
    piSessionId: `pi-node-search-${suffix}`,
    piSessionFile: `/tmp/pi-node-search-${suffix}.jsonl`,
    activeNodeId: `${suffix}-${String(texts.length - 1)}`,
    nodes: texts.map((text, index) => ({
      id: `${suffix}-${String(index)}`,
      parentId: index === 0 ? null : `${suffix}-${String(index - 1)}`,
      piEntryType: 'message',
      kind: index % 2 === 0 ? ('user_message' as const) : ('assistant_message' as const),
      role: index % 2 === 0 ? ('user' as const) : ('assistant' as const),
      timestampMs: index + 1,
      contentJson: JSON.stringify({ parts: [{ type: 'text', text }], model: null }),
      metadataJson: '{}',
      pathDepth: index,
      createdOrder: index,
    })),
  })
}

describe('Session tree search on the Host (B5)', () => {
  it('finds nodes whose full text contains the query, folding case and whitespace', async () => {
    const filler = 'lorem ipsum '.repeat(400)
    const sessionId = await sessionWithTexts('a', [
      'Start here',
      `${filler} the Grüne   Needle is deep in this answer`,
      'Unrelated reply',
    ])
    await sessionWithTexts('b', ['grüne needle in another Session'])

    expect((await searchSessionTreeNodes(sessionId, '  GRÜNE needle ')).map(String)).toEqual([
      'a-1',
    ])
    expect(await searchSessionTreeNodes(sessionId, '   ')).toEqual([])
  })

  it('has no revision without a control state, so nothing is reused', async () => {
    const sessionId = await sessionWithTexts('no-state', ['one'])

    expect(await getSessionNodeMutationRevision(sessionId)).toBeNull()
  })

  it('bumps the revision when an existing node changes, not when nodes are appended', async () => {
    const sessionId = await sessionWithTexts('rev', ['one', 'two'])
    await runStoreEffect(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* sql`
          INSERT INTO session_control_states (
            session_id, state_revision, active_run_id, queue_state, queue_revision, updated_at
          ) VALUES (${sessionId}, 0, NULL, 'running', 0, 1)
        `
      }),
    )
    const start = await getSessionNodeMutationRevision(sessionId)
    await sessionWithTextsAgain(sessionId, 'rev', ['one', 'two', 'three'])
    const afterAppend = await getSessionNodeMutationRevision(sessionId)
    await sessionWithTextsAgain(sessionId, 'rev', ['one, edited', 'two', 'three'])

    expect(afterAppend).toBe(start)
    expect(await getSessionNodeMutationRevision(sessionId)).toBeGreaterThan(afterAppend ?? 0)
  })
})

describe('batched turn changed files (B5)', () => {
  it('reads every listed turn in one call and names turns without a checkpoint', async () => {
    const sessionId = await sessionWithTexts('turns', ['one'])
    const diff = `diff --git a/a.ts b/a.ts
--- a/a.ts
+++ b/a.ts
@@ -0,0 +1,1 @@
+alpha
`
    await recordTurnCheckpoint({ sessionId, turnId: 'turn-1', diff })
    await recordTurnCheckpoint({ sessionId, turnId: 'turn-2', diff: '' })

    expect(await listTurnDiffFiles(sessionId, ['turn-1', 'turn-2', 'missing'])).toEqual({
      'turn-1': [{ path: 'a.ts', additions: 1, deletions: 0 }],
      'turn-2': [],
      missing: [],
    })
    expect(await listTurnDiffFiles(sessionId, [])).toEqual({})
  })
})
